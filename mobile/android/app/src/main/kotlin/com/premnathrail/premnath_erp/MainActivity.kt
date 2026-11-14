package com.premnathrail.premnath_erp

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageInstaller
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import io.flutter.embedding.android.FlutterFragmentActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.MessageDigest

// FragmentActivity: the fingerprint prompt (local_auth / BiometricPrompt) needs it.
//
// Also hosts the app's self-updater (Dart: lib/update/app_updater.dart) on the
// channel 'premnath/updater':
//   canInstall()            -> may this app install apps (Install unknown apps)?
//   openInstallSettings()   -> opens that setting for this app
//   verifyApk({path})       -> {ok, packageName, versionCode, signers[], ownPackage,
//                               ownVersionCode, ownSigners[]} (signers = SHA-256 hex)
//   installApk({path})      -> "started" | "fallback" | "file_missing" | "no_permission" | "failed"
// Results of an install session come back as installResult(code):
//   waiting_user | success | cancelled | no_space | conflict | incompatible |
//   blocked | invalid | failed
class MainActivity : FlutterFragmentActivity() {
    private var channel: MethodChannel? = null
    private var resumed = false

    /// Android's "Install" question, waiting until the app is in front again
    /// (Android does not let a background app open screens).
    private var pendingConfirm: Intent? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val ch = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
        ch.setMethodCallHandler { call, result ->
            when (call.method) {
                "canInstall" -> result.success(canInstall())
                "openInstallSettings" -> {
                    try {
                        openInstallSettings()
                        result.success(null)
                    } catch (e: Exception) {
                        result.error("settings", "could not open settings", null)
                    }
                }
                "verifyApk" -> {
                    val path = call.argument<String>("path")
                    result.success(if (path == null) null else verifyApk(path))
                }
                "installApk" -> {
                    val path = call.argument<String>("path")
                    result.success(if (path == null) "file_missing" else installApk(path))
                }
                else -> result.notImplemented()
            }
        }
        channel = ch
        active = this
    }

    override fun onResume() {
        super.onResume()
        resumed = true
        active = this
        pendingConfirm?.let {
            pendingConfirm = null
            startConfirm(it)
        }
    }

    override fun onPause() {
        resumed = false
        super.onPause()
    }

    override fun onDestroy() {
        if (active === this) active = null
        super.onDestroy()
    }

    private fun canInstall(): Boolean =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) packageManager.canRequestPackageInstalls() else true

    private fun openInstallSettings() {
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName"))
        } else {
            Intent(Settings.ACTION_SECURITY_SETTINGS)
        }
        startActivity(intent)
    }

    /// Who signed the downloaded file, which app and version it is - and the
    /// same for the running app, so Dart can refuse anything that is not a
    /// newer build of this very app signed with the same key.
    private fun verifyApk(path: String): Map<String, Any?> {
        return try {
            val file = File(path)
            if (!file.exists()) return mapOf("ok" to false)
            val archive = archiveInfo(path) ?: return mapOf("ok" to false)
            val own = ownInfo()
            mapOf(
                "ok" to true,
                "packageName" to archive.packageName,
                "versionCode" to versionOf(archive),
                "signers" to signersOf(archive),
                "ownPackage" to packageName,
                "ownVersionCode" to versionOf(own),
                "ownSigners" to signersOf(own),
            )
        } catch (e: Exception) {
            mapOf("ok" to false)
        }
    }

    @Suppress("DEPRECATION")
    private fun archiveInfo(path: String): PackageInfo? {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return packageManager.getPackageArchiveInfo(path, flags)
    }

    @Suppress("DEPRECATION")
    private fun ownInfo(): PackageInfo {
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            PackageManager.GET_SIGNING_CERTIFICATES
        } else {
            PackageManager.GET_SIGNATURES
        }
        return packageManager.getPackageInfo(packageName, flags)
    }

    @Suppress("DEPRECATION")
    private fun versionOf(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

    @Suppress("DEPRECATION")
    private fun signersOf(info: PackageInfo): List<String> {
        val sigs = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.apkContentsSigners
        } else {
            info.signatures
        }
        val digest = MessageDigest.getInstance("SHA-256")
        return (sigs ?: emptyArray()).map { s ->
            digest.digest(s.toByteArray()).joinToString("") { b -> "%02x".format(b) }
        }.sorted()
    }

    private fun installApk(path: String): String {
        val file = File(path)
        if (!file.exists()) return "file_missing"
        if (!canInstall()) return "no_permission"
        return try {
            installWithSession(file)
            "started"
        } catch (e: Exception) {
            // Some phones refuse installer sessions - hand the file to the
            // system installer screen instead.
            try {
                installWithViewIntent(file)
                "fallback"
            } catch (e2: Exception) {
                "failed"
            }
        }
    }

    private fun installWithSession(file: File) {
        val installer = packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL)
        params.setAppPackageName(packageName)
        params.setSize(file.length())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Android 12+: once this app has installed itself, later updates
            // can go through without the "Install" question.
            params.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        if (Build.VERSION.SDK_INT >= 34) {
            try {
                params.setRequestUpdateOwnership(true)
            } catch (e: Throwable) {
                // Not on this build of Android - not needed for the install.
            }
        }
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            file.inputStream().use { input ->
                session.openWrite("base.apk", 0, file.length()).use { output ->
                    input.copyTo(output)
                    session.fsync(output)
                }
            }
            val intent = Intent(this, UpdateInstallReceiver::class.java).setAction(ACTION_INSTALL_STATUS)
            var flags = PendingIntent.FLAG_UPDATE_CURRENT
            // The system adds the result to this intent, so it must be mutable.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) flags = flags or PendingIntent.FLAG_MUTABLE
            val pending = PendingIntent.getBroadcast(this, sessionId, intent, flags)
            session.commit(pending.intentSender)
            session.close()
        } catch (e: Exception) {
            try {
                session.abandon()
            } catch (ignored: Exception) {
            }
            throw e
        }
    }

    private fun installWithViewIntent(file: File) {
        val uri = FileProvider.getUriForFile(this, "$packageName.updater", file)
        // Only the phone's own package installer handles this action.
        @Suppress("DEPRECATION")
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, APK_MIME)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        startActivity(intent)
    }
    private fun startConfirm(confirm: Intent) {
        if (!isInstallerConfirm(this, confirm)) {
            report("failed")
            return
        }
        try {
            startActivity(confirm)
            report("waiting_user")
        } catch (e: Exception) {
            report("failed")
        }
    }

    internal fun onInstallStatus(intent: Intent) {
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        when (status) {
            PackageInstaller.STATUS_PENDING_USER_ACTION -> {
                val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                    intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
                } else {
                    @Suppress("DEPRECATION")
                    intent.getParcelableExtra(Intent.EXTRA_INTENT)
                }
                if (confirm == null) {
                    report("failed")
                } else if (resumed) {
                    startConfirm(confirm)
                } else {
                    pendingConfirm = confirm
                    report("waiting_user")
                }
            }
            PackageInstaller.STATUS_SUCCESS -> report("success")
            PackageInstaller.STATUS_FAILURE_ABORTED -> report("cancelled")
            PackageInstaller.STATUS_FAILURE_STORAGE -> report("no_space")
            PackageInstaller.STATUS_FAILURE_CONFLICT -> report("conflict")
            PackageInstaller.STATUS_FAILURE_INCOMPATIBLE -> report("incompatible")
            PackageInstaller.STATUS_FAILURE_BLOCKED -> report("blocked")
            PackageInstaller.STATUS_FAILURE_INVALID -> report("invalid")
            else -> report("failed")
        }
    }

    private fun report(code: String) {
        runOnUiThread { channel?.invokeMethod("installResult", code) }
    }

    companion object {
        const val CHANNEL = "premnath/updater"
        const val ACTION_INSTALL_STATUS = "com.premnathrail.premnath_erp.UPDATE_INSTALL_STATUS"
        private const val APK_MIME = "application/vnd.android.package-archive"

        private const val ACTION_CONFIRM_INSTALL = "android.content.pm.action.CONFIRM_INSTALL"

        /// Only Android's own "Install" question may be opened from an
        /// installer result - never any other screen, never with extra
        /// file-access grants.
        internal fun isInstallerConfirm(context: Context, confirm: Intent): Boolean {
            confirm.removeFlags(
                Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION or
                    Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION or Intent.FLAG_GRANT_PREFIX_URI_PERMISSION
            )
            if (confirm.action == ACTION_CONFIRM_INSTALL) return true
            return try {
                val info = context.packageManager.resolveActivity(confirm, 0)?.activityInfo?.applicationInfo
                info != null && (info.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            } catch (e: Exception) {
                false
            }
        }

        /// The running screen, for results that arrive through the receiver.
        @Volatile
        internal var active: MainActivity? = null
    }
}

/// Receives the result of an installer session (registered in the manifest,
/// not exported - only this app's PendingIntent reaches it).
class UpdateInstallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val activity = MainActivity.active
        if (activity != null) {
            activity.onInstallStatus(intent)
            return
        }
        // App screen is gone: still show Android's "Install" question.
        val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            val confirm: Intent? = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_INTENT)
            }
            confirm?.takeIf { MainActivity.isInstallerConfirm(context, it) }?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try {
                    context.startActivity(it)
                } catch (ignored: Exception) {
                }
            }
        }
    }
}
