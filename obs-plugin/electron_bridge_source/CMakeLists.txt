cmake_minimum_required(VERSION 3.20)
project(electron_bridge_source VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(libobs REQUIRED)

add_library(electron_bridge_source MODULE
  src/plugin.cpp
)

target_link_libraries(electron_bridge_source PRIVATE OBS::libobs)

if(MSVC)
  target_compile_options(electron_bridge_source PRIVATE /W4)
else()
  target_compile_options(electron_bridge_source PRIVATE -Wall -Wextra -Wpedantic)
endif()

set_target_properties(electron_bridge_source PROPERTIES
  PREFIX ""
  OUTPUT_NAME "electron_bridge_source"
)

install(TARGETS electron_bridge_source
  LIBRARY DESTINATION obs-plugins/64bit
  RUNTIME DESTINATION obs-plugins/64bit
)
