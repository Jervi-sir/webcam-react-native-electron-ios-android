# Electron VirtualCam Frame Protocol (TCP)

Transport:

1. TCP server on `127.0.0.1:19777`.
2. Stream of framed binary packets.

Packet format (little-endian):

1. Magic: 4 bytes ASCII.
   - `EVCM`: JPEG payload mode (native virtual-cam daemons).
   - `EVRG`: RAW RGBA payload mode (OBS plugin).
2. Width: `uint16`.
3. Height: `uint16`.
4. TimestampNs: `uint64`.
5. PayloadLength: `uint32`.
6. Payload bytes:
   - `EVCM`: JPEG frame data (`PayloadLength` bytes).
   - `EVRG`: raw RGBA bytes (`width * height * 4`).

Header size: 20 bytes.

Notes:

1. Sender can drop frames if bridge is disconnected.
2. Receiver should parse in a loop and handle partial packets.
3. If magic mismatch occurs, receiver should resync by scanning for next valid magic.
