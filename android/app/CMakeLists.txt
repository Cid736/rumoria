# The small native piece that starts Node (nodejs-mobile's libnode) in this process.
cmake_minimum_required(VERSION 3.22)
project(rumoria)

add_library(native-lib SHARED src/main/cpp/native-lib.cpp)
include_directories(libnode/include/node/)

add_library(libnode SHARED IMPORTED)
set_target_properties(libnode PROPERTIES IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/libnode/bin/${ANDROID_ABI}/libnode.so)

find_library(log-lib log)
target_link_libraries(native-lib libnode ${log-lib})
# 16 KB pages (newer phones): our own library is ready for them.
target_link_options(native-lib PRIVATE "-Wl,-z,max-page-size=16384")
