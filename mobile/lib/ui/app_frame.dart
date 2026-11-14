import 'package:flutter/material.dart';

import '../api/api.dart';
import '../auth/app_lock.dart';
import '../auth/auth_service.dart';
import 'form.dart';
import '../modules.dart';
import '../modules/home/alerts_screen.dart';
import '../modules/home/my_approvals_screen.dart';
import '../theme.dart';
import '../update/app_updater.dart';
import '../update/update_screen.dart';
import 'widgets.dart';

/// Top bar of every main screen: menu button, logo, alerts bell.
class TopBar extends StatelessWidget implements PreferredSizeWidget {
  const TopBar({super.key, this.actions = const []});
  final List<Widget> actions;

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: Image.asset(
        'assets/logo.png',
        height: 26,
        semanticLabel: 'Premnath Rail',
      ),
      actions: [...actions, const AlertsBell(), const SizedBox(width: 4)],
    );
  }
}

/// The bell with the unread count (portal: NotificationBell,
/// GET /notifications/unread-count). Re-reads after Alerts is closed.
class AlertsBell extends StatefulWidget {
  const AlertsBell({super.key});

  @override
  State<AlertsBell> createState() => _AlertsBellState();
}

class _AlertsBellState extends State<AlertsBell> {
  int _count = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await Api.get('/notifications/unread-count');
      final c = data is Map ? data['count'] : null;
      if (mounted && c is int) setState(() => _count = c);
    } catch (_) {
      // The badge is a hint only; the Alerts screen shows the real error.
    }
  }

  @override
  Widget build(BuildContext context) {
    return IconButton(
      tooltip: 'Alerts',
      icon: Badge(
        isLabelVisible: _count > 0,
        label: Text(_count > 99 ? '99+' : '$_count'),
        backgroundColor: Brand.primary,
        child: const Icon(Icons.notifications_none_rounded),
      ),
      onPressed: () async {
        await Navigator.of(context)
            .push(MaterialPageRoute(builder: (_) => const AlertsScreen()));
        _load();
      },
    );
  }
}

/// One tab of a module's sub-nav (portal: StoreNav, CrmNav ...).
class ModuleTab {
  const ModuleTab({
    required this.label,
    required this.builder,
    this.icon,
    this.visible = true,
  });
  final String label;
  final IconData? icon;

  /// Permission result - hidden tabs are left out (portal hides them too).
  final bool visible;
  final WidgetBuilder builder;
}

/// A module's main screen: top bar, menu, the module's tab row above the
/// page (portal rule: sub-nav renders above the page header), then the
/// selected tab's page.
class ModuleScaffold extends StatefulWidget {
  const ModuleScaffold({
    super.key,
    required this.module,
    required this.tabs,
    this.initialTab = 0,
    this.topActions = const [],
  });
  final ErpModule module;
  final List<ModuleTab> tabs;
  final int initialTab;

  /// Extra top-bar icons (e.g. the module Settings gear, left of the bell).
  final List<Widget> topActions;

  @override
  State<ModuleScaffold> createState() => _ModuleScaffoldState();

  /// Switches the enclosing module to the tab with this label (dashboard
  /// cards jump to their list, as in the portal). False when not found.
  static bool goToTab(BuildContext context, String label) {
    final s = context.findAncestorStateOfType<_ModuleScaffoldState>();
    return s?._goTo(label) ?? false;
  }
}

class _ModuleScaffoldState extends State<ModuleScaffold> {
  late int _index = widget.initialTab;

  bool _goTo(String label) {
    final tabs = widget.tabs.where((t) => t.visible).toList();
    final i = tabs.indexWhere(
      (t) => t.label.toLowerCase() == label.toLowerCase(),
    );
    if (i < 0) return false;
    setState(() => _index = i);
    return true;
  }

  @override
  Widget build(BuildContext context) {
    final user = AuthService.instance.user ?? const <String, dynamic>{};
    final tabs = widget.tabs.where((t) => t.visible).toList();
    if (_index >= tabs.length) _index = 0;
    return Scaffold(
      appBar: TopBar(actions: widget.topActions),
      drawer: AppMenu(
        user: user,
        modules: modulesFor(user),
        current: widget.module,
      ),
      body: tabs.isEmpty
          ? EmptyView(
              'You have no tabs of ${widget.module.title} yet. Ask your admin to give your role access.',
              icon: widget.module.icon,
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (tabs.length > 1)
                  Container(
                    color: Colors.white,
                    height: 50,
                    child: ListView.separated(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 8,
                      ),
                      itemCount: tabs.length,
                      separatorBuilder: (_, _) => const SizedBox(width: 6),
                      itemBuilder: (ctx, i) => _TabChip(
                        tab: tabs[i],
                        selected: i == _index,
                        onTap: () => setState(() => _index = i),
                      ),
                    ),
                  ),
                if (tabs.length > 1) const Divider(height: 1),
                Expanded(
                  child: KeyedSubtree(
                    key: ValueKey(_index),
                    child: Builder(builder: tabs[_index].builder),
                  ),
                ),
              ],
            ),
    );
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.tab,
    required this.selected,
    required this.onTap,
  });
  final ModuleTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : const Color(0xFF334155);
    return Material(
      color: selected ? Brand.primary : Brand.background,
      borderRadius: BorderRadius.circular(10),
      child: InkWell(
        borderRadius: BorderRadius.circular(10),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (tab.icon != null) ...[
                Icon(tab.icon, size: 16, color: fg),
                const SizedBox(width: 6),
              ],
              Text(
                tab.label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                  color: fg,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Inner screen (record detail, sub-page): back arrow, title, actions.
class SubPage extends StatelessWidget {
  const SubPage({
    super.key,
    required this.title,
    required this.body,
    this.actions = const [],
    this.fab,
    this.bottom,
  });
  final String title;
  final Widget body;
  final List<Widget> actions;
  final Widget? fab;

  /// Sticky action bar at the bottom (Approve / Reject, Submit ...).
  final Widget? bottom;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        actions: actions,
      ),
      body: body,
      floatingActionButton: fab,
      bottomNavigationBar: bottom == null
          ? null
          : SafeArea(
              child: Container(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                decoration: const BoxDecoration(
                  color: Colors.white,
                  border: Border(top: BorderSide(color: Brand.border)),
                ),
                child: bottom,
              ),
            ),
    );
  }
}

/// "+ New ..." floating button (portal: primary create button).
class CreateFab extends StatelessWidget {
  const CreateFab({super.key, required this.label, required this.onPressed});
  final String label;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => FloatingActionButton.extended(
    backgroundColor: Brand.primary,
    foregroundColor: Colors.white,
    onPressed: onPressed,
    icon: const Icon(Icons.add_rounded),
    label: Text(label),
  );
}

// ── Menu (portal sidebar) ────────────────────────────────────────────────────

class AppMenu extends StatefulWidget {
  const AppMenu({
    super.key,
    required this.user,
    required this.modules,
    required this.current,
  });
  final Map<String, dynamic> user;
  final List<ErpModule> modules;

  /// Module whose screen is open; null = Dashboard.
  final ErpModule? current;

  @override
  State<AppMenu> createState() => _AppMenuState();
}

class _AppMenuState extends State<AppMenu> {
  late bool _upcomingOpen = widget.current?.upcoming ?? false;

  void _go(ErpModule? module) {
    final nav = Navigator.of(
      context,
    ); // grab before the menu closes and unmounts
    nav.pop(); // close the menu
    if (module == widget.current) return;
    nav.popUntil((r) => r.isFirst);
    if (module != null) {
      nav.push(MaterialPageRoute(builder: (_) => module.screen(module)));
    }
  }

  void _openApprovals() {
    final nav = Navigator.of(context);
    nav.pop();
    nav.popUntil((r) => r.isFirst);
    nav.push(MaterialPageRoute(builder: (_) => const MyApprovalsScreen()));
  }

  @override
  Widget build(BuildContext context) {
    final live = widget.modules.where((m) => !m.upcoming).toList();
    final upcoming = widget.modules.where((m) => m.upcoming).toList();
    return Drawer(
      backgroundColor: Colors.white,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Image.asset(
                  'assets/logo.png',
                  height: 30,
                  semanticLabel: 'Premnath Rail',
                ),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: Caps('Navigation'),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  _MenuItem(
                    Icons.home_outlined,
                    'Dashboard',
                    selected: widget.current == null,
                    onTap: () => _go(null),
                  ),
                  // Second, for everyone - same as the portal sidebar.
                  _MenuItem(
                    Icons.fact_check_outlined,
                    'My Approvals',
                    selected: false,
                    onTap: _openApprovals,
                  ),
                  for (final m in live)
                    _MenuItem(
                      m.icon,
                      m.menuLabel,
                      selected: widget.current == m,
                      onTap: () => _go(m),
                    ),
                  if (upcoming.isNotEmpty) ...[
                    InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () =>
                          setState(() => _upcomingOpen = !_upcomingOpen),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 14, 8, 8),
                        child: Caps(
                          '${_upcomingOpen ? '▾' : '▸'}  Upcoming (${upcoming.length})',
                        ),
                      ),
                    ),
                    if (_upcomingOpen)
                      for (final m in upcoming)
                        _MenuItem(
                          m.icon,
                          m.menuLabel,
                          selected: widget.current == m,
                          onTap: () => _go(m),
                        ),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            UserChip(user: widget.user),
          ],
        ),
      ),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem(
    this.icon,
    this.label, {
    required this.selected,
    required this.onTap,
  });
  final IconData icon;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? Colors.white : const Color(0xFF334155);
    return Padding(
      padding: const EdgeInsets.only(bottom: 2),
      child: Material(
        color: selected ? Brand.primary : Colors.transparent,
        borderRadius: BorderRadius.circular(12),
        child: InkWell(
          borderRadius: BorderRadius.circular(12),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            child: Row(
              children: [
                Icon(icon, size: 20, color: fg),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                      color: fg,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String initialsOf(String name) {
  final parts = name
      .trim()
      .split(RegExp(r'\s+'))
      .where((p) => p.isNotEmpty)
      .toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : ''))
      .toUpperCase();
}

String _roleLabel(Map<String, dynamic> user) {
  final role = (user['role'] as String?) ?? '';
  if (role.isEmpty) return '';
  return role[0].toUpperCase() + role.substring(1);
}

class UserChip extends StatelessWidget {
  const UserChip({super.key, required this.user});
  final Map<String, dynamic> user;

  @override
  Widget build(BuildContext context) {
    final name = (user['name'] as String?) ?? '';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: CircleAvatar(
        backgroundColor: Brand.primary,
        child: Text(
          initialsOf(name),
          style: const TextStyle(
            color: Colors.white,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      title: Text(
        name,
        style: const TextStyle(
          fontWeight: FontWeight.w700,
          color: Brand.heading,
        ),
      ),
      subtitle: Text(
        _roleLabel(user),
        style: const TextStyle(color: Brand.muted, fontSize: 12),
      ),
      trailing: const Icon(Icons.keyboard_arrow_up_rounded),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: Colors.transparent,
        // Tall content (app lock, fingerprint, app update): may use more than
        // the default half screen and scrolls on small phones.
        isScrollControlled: true,
        useSafeArea: true,
        builder: (_) => _ProfileCard(user: user),
      ),
    );
  }
}

/// The portal's user-chip popup: name, role, email, designation,
/// department, Logout.
class _ProfileCard extends StatelessWidget {
  const _ProfileCard({required this.user});
  final Map<String, dynamic> user;

  @override
  Widget build(BuildContext context) {
    final name = (user['name'] as String?) ?? '';
    final role = _roleLabel(user);
    return Container(
      margin: const EdgeInsets.all(12),
      clipBehavior: Clip.antiAlias,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                color: Brand.heading,
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 24,
                      backgroundColor: Brand.primary,
                      child: Text(
                        initialsOf(name),
                        style: const TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 16,
                        ),
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            name,
                            style: const TextStyle(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              fontSize: 16,
                            ),
                          ),
                          if (role.isNotEmpty) ...[
                            const SizedBox(height: 4),
                            Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: 10,
                                vertical: 2,
                              ),
                              decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(20),
                              ),
                              child: Text(
                                role,
                                style: const TextStyle(
                                  color: Color(0xFFCBD5E1),
                                  fontSize: 11,
                                ),
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              _InfoRow(Icons.mail_outline_rounded, 'Email', user['email']),
              _InfoRow(
                Icons.work_outline_rounded,
                'Designation',
                user['designation'],
              ),
              _InfoRow(
                Icons.apartment_outlined,
                'Department',
                user['department'],
              ),
              const _AppLockActions(),
              const _AppUpdateRow(),
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Brand.danger,
                    backgroundColor: Brand.dangerSoft,
                    side: BorderSide(
                      color: Brand.danger.withValues(alpha: 0.3),
                    ),
                    minimumSize: const Size.fromHeight(44),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  icon: const Icon(Icons.logout_rounded, size: 18),
                  label: const Text(
                    'Logout',
                    style: TextStyle(fontWeight: FontWeight.w600),
                  ),
                  onPressed: () {
                    Navigator.of(context).popUntil((r) => r.isFirst);
                    AuthService.instance.signOut();
                  },
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow(this.icon, this.label, this.value);
  final IconData icon;
  final String label;
  final Object? value;

  @override
  Widget build(BuildContext context) {
    final text = value is String && (value as String).isNotEmpty
        ? value as String
        : '—';
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
      child: Row(
        children: [
          Icon(icon, size: 18, color: const Color(0xFF334155)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Caps(label),
                const SizedBox(height: 2),
                Text(
                  text,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontWeight: FontWeight.w600,
                    color: Brand.heading,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Profile › "App update": this phone's version, a dot when a newer
/// version is waiting; opens the App update screen.
class _AppUpdateRow extends StatelessWidget {
  const _AppUpdateRow();

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppUpdater.instance,
      builder: (context, _) {
        final up = AppUpdater.instance;
        final r = up.latest;
        final value = up.hasUpdate && r != null
            ? 'Version ${r.versionName.isEmpty ? r.versionCode : r.versionName} available'
            : (up.currentLabel.isEmpty ? 'Check for updates' : up.currentLabel);
        return InkWell(
          onTap: () {
            final nav = Navigator.of(context);
            nav.pop(); // close the profile popup
            nav.push(MaterialPageRoute(builder: (_) => const UpdateScreen()));
          },
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
            child: Row(
              children: [
                Badge(
                  isLabelVisible: up.hasUpdate,
                  smallSize: 8,
                  backgroundColor: Brand.primary,
                  child: const Icon(
                    Icons.system_update_rounded,
                    size: 18,
                    color: Color(0xFF334155),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Caps('App update'),
                      const SizedBox(height: 2),
                      Text(
                        value,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontWeight: FontWeight.w600,
                          color: up.hasUpdate
                              ? Brand.primaryActive
                              : Brand.heading,
                        ),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.chevron_right_rounded, color: Brand.muted),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// Portal user-chip popup: Lock now, Change app password - plus the phone's
/// fingerprint unlock switch. Shown only when the portal's app lock is on.
/// Equal-height, single-line pill buttons in the profile popup.
final ButtonStyle _lockBtnStyle = OutlinedButton.styleFrom(
  minimumSize: const Size(0, 40),
  padding: const EdgeInsets.symmetric(horizontal: 16),
  tapTargetSize: MaterialTapTargetSize.shrinkWrap,
);

class _AppLockActions extends StatelessWidget {
  const _AppLockActions();

  Future<void> _change(BuildContext context) async {
    final lock = AppLock.instance;
    String current = '', next = '', again = '';
    final saved = await showFormSheet(
      context,
      title: 'Change app password',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        AppTextField(
          label: 'Current app password',
          required: true,
          onChanged: (v) => current = v,
          keyboardType: TextInputType.visiblePassword,
        ),
        AppTextField(
          label: 'New app password',
          required: true,
          onChanged: (v) => next = v,
          hint: 'At least ${lock.minLength} characters',
        ),
        AppTextField(
          label: 'Type it again',
          required: true,
          onChanged: (v) => again = v,
        ),
      ],
      onSave: () async {
        requireField(current, 'Current app password');
        if (next.length < lock.minLength) {
          throw 'The new app password must be at least ${lock.minLength} characters.';
        }
        if (next != again) {
          throw 'The two new passwords are not the same - type them again.';
        }
        await lock.setPassword(next, current: current);
      },
    );
    if (saved && context.mounted) showSnack(context, 'App password changed.');
  }

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: AppLock.instance,
      builder: (context, _) {
        final lock = AppLock.instance;
        if (!lock.enabled || !lock.hasPassword) return const SizedBox.shrink();
        return Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Same height, one line each: "Lock now" only as wide as its
              // text, "Change app password" takes the rest.
              Row(
                children: [
                  OutlinedButton(
                    style: _lockBtnStyle,
                    onPressed: () {
                      Navigator.of(context).pop();
                      runAction(context, lock.lockNow);
                    },
                    child: const Text('Lock now', maxLines: 1),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton(
                      style: _lockBtnStyle,
                      onPressed: () => _change(context),
                      child: const FittedBox(
                        fit: BoxFit.scaleDown,
                        child: Text('Change app password', maxLines: 1),
                      ),
                    ),
                  ),
                ],
              ),
              FutureBuilder<bool>(
                future: lock.biometricAvailable(),
                builder: (context, snap) {
                  if (snap.data != true) return const SizedBox.shrink();
                  return SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    secondary: const Icon(Icons.fingerprint_rounded),
                    title: const Text('Unlock with fingerprint'),
                    subtitle: Text(
                      lock.biometricEnabled
                          ? 'On - the app password is kept in this phone\'s secure storage.'
                          : 'Turns on the next time you unlock with your app password.',
                    ),
                    value: lock.biometricEnabled,
                    onChanged: (v) async {
                      if (v) {
                        final pw = await promptDialog(
                          context,
                          title: 'Unlock with fingerprint',
                          message:
                              'Enter your app password once to turn this on.',
                          label: 'App password',
                          confirmLabel: 'Turn on',
                        );
                        if (pw == null || pw.isEmpty || !context.mounted) {
                          return;
                        }
                        // Check it with the server before keeping it.
                        final ok = await runAction(
                          context,
                          () => lock.unlock(pw),
                        );
                        if (ok) await lock.enableBiometric(pw);
                      } else {
                        await lock.disableBiometric();
                      }
                    },
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }
}
