import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'auth/app_lock.dart';
import 'auth/auth_service.dart';
import 'screens/home_shell.dart';
import 'screens/lock_screen.dart';
import 'screens/login_screen.dart';
import 'theme.dart';
import 'ui/download_overlay.dart';
import 'update/app_updater.dart';
import 'update/update_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('en_IN');
  // Self-update: checks after login and every 6 hours (lib/update/).
  unawaited(AppUpdater.instance.attach());
  // A part of a screen that fails to draw shows a calm message instead of
  // Flutter's red/grey box with code text (details still go to the log).
  ErrorWidget.builder = (details) {
    debugPrint('Screen error: ${details.exceptionAsString()}');
    return const Material(
      color: Colors.transparent,
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Text(
          'This part of the screen could not be shown. Go back and open it again; '
          'if it keeps happening, tell your admin.',
          style: TextStyle(color: Brand.muted, fontSize: 13),
        ),
      ),
    );
  };
  runApp(const PremnathApp());
}

class PremnathApp extends StatelessWidget {
  const PremnathApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Premnath ERP',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const _AuthGate(),
      // Every tap counts as activity for the app lock; while the session is
      // locked the lock screen covers whatever screen is open (the person
      // comes back to the same place after unlocking).
      builder: (context, child) => Listener(
        behavior: HitTestBehavior.translucent,
        onPointerDown: (_) => AppLock.instance.touch(),
        child: ListenableBuilder(
          listenable: Listenable.merge([AuthService.instance, AppLock.instance, AppUpdater.instance]),
          builder: (context, _) {
            final locked = AuthService.instance.isSignedIn && AppLock.instance.mustShow;
            final mustUpdate = AuthService.instance.isSignedIn && AppUpdater.instance.mustUpdate;
            return Stack(
              children: [
                ?child,
                // File download progress (attachments, PDFs, Word) over any screen.
                const DownloadOverlay(),
                // A required update covers the app; the lock screen (below in
                // this list = drawn on top) still comes first, because the
                // server refuses the download on a locked session.
                if (mustUpdate)
                  Positioned.fill(
                    key: const ValueKey('required-update'),
                    child: HeroControllerScope.none(
                      child: Navigator(
                        onGenerateRoute: (_) => MaterialPageRoute(builder: (_) => const RequiredUpdateScreen()),
                      ),
                    ),
                  ),
                if (locked)
                  // Own navigator so the lock screen's dialogs work. It must
                  // NOT share MaterialApp's HeroController with the main
                  // navigator: removing it after unlock would leave the main
                  // navigator broken (every push then fails `!_debugLocked`).
                  Positioned.fill(
                    key: const ValueKey('app-lock'),
                    child: HeroControllerScope.none(
                      child: Navigator(
                        onGenerateRoute: (_) => MaterialPageRoute(builder: (_) => const LockScreen()),
                      ),
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }
}

/// Splash while the saved Microsoft account signs in silently, then login or home.
class _AuthGate extends StatefulWidget {
  const _AuthGate();

  @override
  State<_AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<_AuthGate> {
  late final Future<void> _restoring = AuthService.instance.restore();

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<void>(
      future: _restoring,
      builder: (context, snapshot) {
        if (snapshot.connectionState != ConnectionState.done) {
          return const Scaffold(body: Center(child: CircularProgressIndicator()));
        }
        return ListenableBuilder(
          listenable: AuthService.instance,
          builder: (context, _) =>
              AuthService.instance.isSignedIn ? const HomeShell() : const LoginScreen(),
        );
      },
    );
  }
}
