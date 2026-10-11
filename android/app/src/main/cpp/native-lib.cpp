// Starts Node (nodejs-mobile) with Rumoria's server. Its environment comes
// from Java as "NAME=value" strings; its stdout and stderr go to logcat
// (tag "RumoriaNode"). Node runs until the process ends: it can only be
// started once per process.
#include <jni.h>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>
#include <pthread.h>
#include <unistd.h>
#include <android/log.h>
#include "node.h"

static const char *TAG = "RumoriaNode";
static int pipe_out[2];
static int pipe_err[2];

static void *pump(void *arg) {
    int fd = *static_cast<int *>(arg);
    int prio = fd == pipe_err[0] ? ANDROID_LOG_WARN : ANDROID_LOG_INFO;
    char buf[2048];
    ssize_t n;
    while ((n = read(fd, buf, sizeof buf - 1)) > 0) {
        if (buf[n - 1] == '\n') --n;
        buf[n] = 0;
        __android_log_write(prio, TAG, buf);
    }
    return nullptr;
}

static void redirect_output() {
    setvbuf(stdout, nullptr, _IONBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pipe_out) == 0) dup2(pipe_out[1], STDOUT_FILENO);
    if (pipe(pipe_err) == 0) dup2(pipe_err[1], STDERR_FILENO);
    pthread_t t1, t2;
    if (pthread_create(&t1, nullptr, pump, &pipe_out[0]) == 0) pthread_detach(t1);
    if (pthread_create(&t2, nullptr, pump, &pipe_err[0]) == 0) pthread_detach(t2);
}

static std::vector<std::string> strings(JNIEnv *env, jobjectArray array) {
    std::vector<std::string> out;
    jsize n = env->GetArrayLength(array);
    for (jsize i = 0; i < n; i++) {
        auto s = static_cast<jstring>(env->GetObjectArrayElement(array, i));
        const char *c = env->GetStringUTFChars(s, nullptr);
        out.emplace_back(c);
        env->ReleaseStringUTFChars(s, c);
        env->DeleteLocalRef(s);
    }
    return out;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_rumoria_app_NodeRunner_startNode(JNIEnv *env, jclass, jobjectArray jargs, jobjectArray jenv) {
    for (const std::string &kv : strings(env, jenv)) {
        size_t eq = kv.find('=');
        if (eq != std::string::npos && eq > 0) setenv(kv.substr(0, eq).c_str(), kv.substr(eq + 1).c_str(), 1);
    }
    std::vector<std::string> args = strings(env, jargs);
    // libuv wants every argument in one block of memory.
    size_t size = 0;
    for (const auto &a : args) size += a.size() + 1;
    char *block = static_cast<char *>(calloc(size, 1));
    std::vector<char *> argv;
    char *at = block;
    for (const auto &a : args) {
        memcpy(at, a.c_str(), a.size() + 1);
        argv.push_back(at);
        at += a.size() + 1;
    }
    redirect_output();
    return node::Start(static_cast<int>(argv.size()), argv.data());
}
