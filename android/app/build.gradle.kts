// Rumoria for Android: the same server (Node, via nodejs-mobile) and the same
// page as the desktop app, inside a WebView; yt-dlp runs on the phone
// (youtubedl-android: Python, yt-dlp and QuickJS for YouTube's challenges).
//
// Before building: `npm run android:prepare` (from the repo's root) fetches
// libnode and copies the built page and the server into the app's assets.
import java.util.Properties

plugins {
    id("com.android.application")
}

// The version is the desktop app's (package.json): one number for both.
val pkgVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val (vMajor, vMinor, vPatch) = pkgVersion.split(".").map { it.toInt() }

// The release key lives outside the repository (see docs/ANDROID.md).
val signingFile = File(System.getenv("RUMORIA_ANDROID_SIGNING") ?: "${System.getProperty("user.home")}/.rumoria/android-signing.properties")
val signing = Properties().apply { if (signingFile.isFile) signingFile.inputStream().use { load(it) } }

android {
    namespace = "com.rumoria.app"
    compileSdk = 37
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "com.rumoria.app"
        minSdk = 26
        targetSdk = 36
        versionCode = vMajor * 10000 + vMinor * 100 + vPatch
        versionName = pkgVersion
        externalNativeBuild {
            cmake {
                arguments += "-DANDROID_STL=c++_shared"
            }
        }
    }

    // One APK per kind of processor (each carries its own Node and Python).
    splits {
        abi {
            isEnable = true
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = false
        }
    }

    externalNativeBuild {
        cmake {
            path = file("CMakeLists.txt")
            version = "3.31.6"
        }
    }

    sourceSets {
        getByName("main") {
            jniLibs.directories.add("libnode/bin")
        }
    }

    packaging {
        jniLibs {
            // Python and QuickJS are run as programs: they have to be unpacked on install.
            useLegacyPackaging = true
            pickFirsts += "**/libc++_shared.so"
            // Python's files packed as a .so (not a real library): nothing to strip.
            keepDebugSymbols += "**/libpython.zip.so"
        }
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = File(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("androidx.core:core:1.19.0")
    implementation("androidx.webkit:webkit:1.17.0")
    implementation("androidx.media:media:1.7.1")
}
