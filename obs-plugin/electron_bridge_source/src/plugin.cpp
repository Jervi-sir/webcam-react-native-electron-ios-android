#include <obs-module.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#pragma comment(lib, "ws2_32.lib")
#else
#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

OBS_DECLARE_MODULE()
OBS_MODULE_AUTHOR("Jervi")

const char *obs_module_description(void)
{
	return "Receives RAW RGBA frames from Electron virtual bridge and renders them as an OBS source.";
}

namespace {

#ifdef _WIN32
using socket_t = SOCKET;
constexpr socket_t kInvalidSocket = INVALID_SOCKET;
#else
using socket_t = int;
constexpr socket_t kInvalidSocket = -1;
#endif

constexpr const char* kSourceId = "electron_bridge_source";
constexpr uint16_t kDefaultPort = 19777;
constexpr uint32_t kPacketHeaderSize = 20;
constexpr uint32_t kMaxPayloadBytes = 3840 * 2160 * 4;  // 4K RGBA

constexpr uint8_t kMagic0 = 'E';
constexpr uint8_t kMagic1 = 'V';
constexpr uint8_t kMagic2 = 'R';
constexpr uint8_t kMagic3 = 'G';

uint16_t read_u16_le(const std::vector<uint8_t>& data, size_t offset)
{
	return static_cast<uint16_t>(data[offset]) |
	       (static_cast<uint16_t>(data[offset + 1]) << 8);
}

uint32_t read_u32_le(const std::vector<uint8_t>& data, size_t offset)
{
	return static_cast<uint32_t>(data[offset]) |
	       (static_cast<uint32_t>(data[offset + 1]) << 8) |
	       (static_cast<uint32_t>(data[offset + 2]) << 16) |
	       (static_cast<uint32_t>(data[offset + 3]) << 24);
}

bool has_magic_prefix(const std::vector<uint8_t>& data)
{
	return data.size() >= 4 && data[0] == kMagic0 && data[1] == kMagic1 &&
	       data[2] == kMagic2 && data[3] == kMagic3;
}

size_t find_next_magic(const std::vector<uint8_t>& data)
{
	if (data.size() < 4) {
		return std::string::npos;
	}

	for (size_t i = 1; i + 3 < data.size(); i++) {
		if (data[i] == kMagic0 && data[i + 1] == kMagic1 &&
		    data[i + 2] == kMagic2 && data[i + 3] == kMagic3) {
			return i;
		}
	}

	return std::string::npos;
}

void close_socket(socket_t& socket)
{
	if (socket == kInvalidSocket) {
		return;
	}

#ifdef _WIN32
	shutdown(socket, SD_BOTH);
	closesocket(socket);
#else
	shutdown(socket, SHUT_RDWR);
	close(socket);
#endif

	socket = kInvalidSocket;
}

struct electron_bridge_source {
	obs_source_t* source = nullptr;
	std::mutex frame_mutex;
	std::vector<uint8_t> pending_rgba;
	uint32_t pending_width = 0;
	uint32_t pending_height = 0;
	uint64_t pending_serial = 0;
	uint64_t uploaded_serial = 0;
	gs_texture_t* texture = nullptr;
	uint32_t texture_width = 0;
	uint32_t texture_height = 0;
	uint16_t port = kDefaultPort;
	std::atomic<bool> running = false;
	std::thread server_thread;
	std::mutex socket_mutex;
	socket_t listen_socket = kInvalidSocket;
	socket_t client_socket = kInvalidSocket;
#ifdef _WIN32
	bool wsa_started = false;
#endif
};

void store_frame(electron_bridge_source* context, uint16_t width, uint16_t height,
		 const uint8_t* rgba_data, size_t size)
{
	std::lock_guard<std::mutex> lock(context->frame_mutex);
	context->pending_width = width;
	context->pending_height = height;
	context->pending_rgba.assign(rgba_data, rgba_data + size);
	context->pending_serial += 1;
}

bool process_stream_buffer(electron_bridge_source* context,
		   std::vector<uint8_t>& stream_buffer)
{
	while (stream_buffer.size() >= kPacketHeaderSize) {
		if (!has_magic_prefix(stream_buffer)) {
			size_t next_magic = find_next_magic(stream_buffer);
			if (next_magic == std::string::npos) {
				stream_buffer.clear();
				return true;
			}

			stream_buffer.erase(stream_buffer.begin(),
					   stream_buffer.begin() + static_cast<long long>(next_magic));
			continue;
		}

		const uint16_t width = read_u16_le(stream_buffer, 4);
		const uint16_t height = read_u16_le(stream_buffer, 6);
		const uint32_t payload_bytes = read_u32_le(stream_buffer, 16);

		if (width == 0 || height == 0 || payload_bytes == 0 ||
		    payload_bytes > kMaxPayloadBytes ||
		    payload_bytes != static_cast<uint32_t>(width) *
					      static_cast<uint32_t>(height) * 4u) {
			stream_buffer.erase(stream_buffer.begin(), stream_buffer.begin() + 4);
			continue;
		}

		const uint32_t packet_size = kPacketHeaderSize + payload_bytes;
		if (stream_buffer.size() < packet_size) {
			return true;
		}

		store_frame(context, width, height,
		    stream_buffer.data() + kPacketHeaderSize,
		    payload_bytes);
		stream_buffer.erase(stream_buffer.begin(),
				   stream_buffer.begin() + static_cast<long long>(packet_size));
	}

	return true;
}

void receive_client_loop(electron_bridge_source* context, socket_t client)
{
	std::vector<uint8_t> stream_buffer;
	stream_buffer.reserve(1024 * 1024);

	std::vector<uint8_t> recv_buffer;
	recv_buffer.resize(64 * 1024);

	while (context->running.load()) {
		int received = recv(client, reinterpret_cast<char*>(recv_buffer.data()),
				    static_cast<int>(recv_buffer.size()), 0);
		if (received <= 0) {
			break;
		}

		stream_buffer.insert(stream_buffer.end(), recv_buffer.begin(),
				     recv_buffer.begin() + received);
		if (!process_stream_buffer(context, stream_buffer)) {
			break;
		}
	}
}

socket_t create_listen_socket(uint16_t port)
{
	socket_t listen_socket = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (listen_socket == kInvalidSocket) {
		return kInvalidSocket;
	}

	int reuse = 1;
	setsockopt(listen_socket, SOL_SOCKET, SO_REUSEADDR,
		   reinterpret_cast<const char*>(&reuse), sizeof(reuse));

	sockaddr_in address {};
	address.sin_family = AF_INET;
	address.sin_port = htons(port);
	inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);

	if (bind(listen_socket, reinterpret_cast<sockaddr*>(&address),
		 sizeof(address)) != 0) {
		close_socket(listen_socket);
		return kInvalidSocket;
	}

	if (listen(listen_socket, 1) != 0) {
		close_socket(listen_socket);
		return kInvalidSocket;
	}

	return listen_socket;
}

void server_thread_main(electron_bridge_source* context)
{
#ifdef _WIN32
	WSADATA wsa_data {};
	if (WSAStartup(MAKEWORD(2, 2), &wsa_data) != 0) {
		blog(LOG_ERROR, "[electron-bridge-source] WSAStartup failed");
		return;
	}
	context->wsa_started = true;
#endif

	while (context->running.load()) {
		socket_t listen_socket = create_listen_socket(context->port);
		if (listen_socket == kInvalidSocket) {
			blog(LOG_WARNING,
			     "[electron-bridge-source] listen failed on 127.0.0.1:%u, retrying",
			     context->port);
			std::this_thread::sleep_for(std::chrono::milliseconds(800));
			continue;
		}

		{
			std::lock_guard<std::mutex> lock(context->socket_mutex);
			context->listen_socket = listen_socket;
		}

		while (context->running.load()) {
			fd_set read_set;
			FD_ZERO(&read_set);
			FD_SET(listen_socket, &read_set);

			timeval timeout {};
			timeout.tv_sec = 1;
			timeout.tv_usec = 0;

			int selected = select(static_cast<int>(listen_socket + 1), &read_set,
					     nullptr, nullptr, &timeout);
			if (selected <= 0) {
				continue;
			}

			sockaddr_in client_addr {};
#ifdef _WIN32
			int client_addr_len = sizeof(client_addr);
#else
			socklen_t client_addr_len = sizeof(client_addr);
#endif
			socket_t client_socket =
				accept(listen_socket, reinterpret_cast<sockaddr*>(&client_addr),
				       &client_addr_len);
			if (client_socket == kInvalidSocket) {
				continue;
			}

			{
				std::lock_guard<std::mutex> lock(context->socket_mutex);
				context->client_socket = client_socket;
			}

			blog(LOG_INFO,
			     "[electron-bridge-source] client connected, receiving EVRG frames");
			receive_client_loop(context, client_socket);
			blog(LOG_INFO, "[electron-bridge-source] client disconnected");

			{
				std::lock_guard<std::mutex> lock(context->socket_mutex);
				close_socket(context->client_socket);
			}
		}

		{
			std::lock_guard<std::mutex> lock(context->socket_mutex);
			close_socket(context->listen_socket);
		}
	}

#ifdef _WIN32
	if (context->wsa_started) {
		WSACleanup();
		context->wsa_started = false;
	}
#endif
}

void stop_server(electron_bridge_source* context)
{
	if (!context->running.exchange(false)) {
		return;
	}

	{
		std::lock_guard<std::mutex> lock(context->socket_mutex);
		close_socket(context->client_socket);
		close_socket(context->listen_socket);
	}

	if (context->server_thread.joinable()) {
		context->server_thread.join();
	}
}

void start_server(electron_bridge_source* context)
{
	if (context->running.exchange(true)) {
		return;
	}

	context->server_thread = std::thread(server_thread_main, context);
}

const char* electron_bridge_source_get_name(void*)
{
	return "Electron Camera Bridge (TCP)";
}

void* electron_bridge_source_create(obs_data_t* settings, obs_source_t* source)
{
	auto* context = new electron_bridge_source();
	context->source = source;
	context->port = static_cast<uint16_t>(obs_data_get_int(settings, "port"));
	if (context->port == 0) {
		context->port = kDefaultPort;
	}

	start_server(context);
	blog(LOG_INFO, "[electron-bridge-source] created on port %u", context->port);
	return context;
}

void electron_bridge_source_destroy(void* data)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context) {
		return;
	}

	stop_server(context);

	obs_enter_graphics();
	if (context->texture) {
		gs_texture_destroy(context->texture);
		context->texture = nullptr;
	}
	obs_leave_graphics();

	delete context;
}

void electron_bridge_source_update(void* data, obs_data_t* settings)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context) {
		return;
	}

	uint16_t new_port = static_cast<uint16_t>(obs_data_get_int(settings, "port"));
	if (new_port == 0) {
		new_port = kDefaultPort;
	}

	if (new_port != context->port) {
		blog(LOG_INFO, "[electron-bridge-source] switching port %u -> %u", context->port,
		     new_port);
		stop_server(context);
		context->port = new_port;
		start_server(context);
	}
}

void electron_bridge_source_video_tick(void* data, float)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context) {
		return;
	}

	std::vector<uint8_t> local_rgba;
	uint32_t local_width = 0;
	uint32_t local_height = 0;
	uint64_t local_serial = 0;

	{
		std::lock_guard<std::mutex> lock(context->frame_mutex);
		if (context->pending_serial == context->uploaded_serial ||
		    context->pending_rgba.empty()) {
			return;
		}

		local_width = context->pending_width;
		local_height = context->pending_height;
		local_serial = context->pending_serial;
		local_rgba = context->pending_rgba;
	}

	obs_enter_graphics();
	if (context->texture == nullptr || context->texture_width != local_width ||
	    context->texture_height != local_height) {
		if (context->texture != nullptr) {
			gs_texture_destroy(context->texture);
			context->texture = nullptr;
		}

		const uint8_t* frame_data = local_rgba.data();
		context->texture =
			gs_texture_create(local_width, local_height, GS_RGBA, 1, &frame_data,
					  GS_DYNAMIC);
		context->texture_width = local_width;
		context->texture_height = local_height;
	} else {
		gs_texture_set_image(context->texture, local_rgba.data(),
				     local_width * 4, false);
	}
	obs_leave_graphics();

	context->uploaded_serial = local_serial;
}

void electron_bridge_source_video_render(void* data, gs_effect_t*)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context || !context->texture) {
		return;
	}

	gs_effect_t* effect = obs_get_base_effect(OBS_EFFECT_DEFAULT);
	if (!effect) {
		return;
	}

	gs_eparam_t* image = gs_effect_get_param_by_name(effect, "image");
	gs_effect_set_texture(image, context->texture);

	while (gs_effect_loop(effect, "Draw")) {
		gs_draw_sprite(context->texture, 0, context->texture_width,
			       context->texture_height);
	}
}

uint32_t electron_bridge_source_get_width(void* data)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context) {
		return 0;
	}
	return context->texture_width;
}

uint32_t electron_bridge_source_get_height(void* data)
{
	auto* context = static_cast<electron_bridge_source*>(data);
	if (!context) {
		return 0;
	}
	return context->texture_height;
}

obs_properties_t* electron_bridge_source_get_properties(void*)
{
	obs_properties_t* props = obs_properties_create();
	obs_properties_add_int(props, "port", "Listen Port", 1, 65535, 1);
	return props;
}

void electron_bridge_source_get_defaults(obs_data_t* settings)
{
	obs_data_set_default_int(settings, "port", kDefaultPort);
}

obs_source_info electron_bridge_source_info = {
	.id = kSourceId,
	.type = OBS_SOURCE_TYPE_INPUT,
	.output_flags = OBS_SOURCE_VIDEO,
	.get_name = electron_bridge_source_get_name,
	.create = electron_bridge_source_create,
	.destroy = electron_bridge_source_destroy,
	.update = electron_bridge_source_update,
	.get_properties = electron_bridge_source_get_properties,
	.get_defaults = electron_bridge_source_get_defaults,
	.video_tick = electron_bridge_source_video_tick,
	.video_render = electron_bridge_source_video_render,
	.get_width = electron_bridge_source_get_width,
	.get_height = electron_bridge_source_get_height,
};

}  // namespace

bool obs_module_load(void)
{
	obs_register_source(&electron_bridge_source_info);
	blog(LOG_INFO, "electron_bridge_source loaded");
	return true;
}
