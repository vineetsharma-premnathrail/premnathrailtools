import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../modules.dart';
import '../theme.dart';

/// Logged-in frame. Mirrors the portal at phone width: a top bar with the
/// menu button and logo, the sidebar as a slide-in menu, Dashboard as home.
class HomeShell extends StatelessWidget {
  const HomeShell({super.key});

  @override
  Widget build(BuildContext context) {
    final user = AuthService.instance.user ?? const <String, dynamic>{};
    final modules = modulesFor(user);
    return Scaffold(
      appBar: const _TopBar(),
      drawer: _AppMenu(user: user, modules: modules, current: null),
      body: _Dashboard(user: user, modules: modules),
    );
  }
}

void _open(BuildContext context, Widget screen) =>
    Navigator.of(context).push(MaterialPageRoute(builder: (_) => screen));

class _TopBar extends StatelessWidget implements PreferredSizeWidget {
  const _TopBar();

  @override
  Size get preferredSize => const Size.fromHeight(kToolbarHeight);

  @override
  Widget build(BuildContext context) {
    return AppBar(
      title: Image.asset('assets/logo.png', height: 26, semanticLabel: 'Premnath Rail'),
      actions: [
        IconButton(
          tooltip: 'Alerts',
          icon: const Icon(Icons.notifications_none_rounded),
          onPressed: () => _open(
              context,
              const _PlaceholderScreen(Icons.notifications_none_rounded, 'Alerts',
                  'Your portal notifications will show here.')),
        ),
        const SizedBox(width: 4),
      ],
    );
  }
}

// ── Menu (portal sidebar) ────────────────────────────────────────────────────

class _AppMenu extends StatefulWidget {
  const _AppMenu({required this.user, required this.modules, required this.current});
  final Map<String, dynamic> user;
  final List<ErpModule> modules;

  /// Module whose screen is open; null = Dashboard.
  final ErpModule? current;

  @override
  State<_AppMenu> createState() => _AppMenuState();
}

class _AppMenuState extends State<_AppMenu> {
  late bool _upcomingOpen = widget.current?.upcoming ?? false;

  void _go(ErpModule? module) {
    final nav = Navigator.of(context); // grab before the menu closes and unmounts
    nav.pop(); // close the menu
    if (module == widget.current) return;
    nav.popUntil((r) => r.isFirst);
    if (module != null) {
      nav.push(MaterialPageRoute(builder: (_) => ModuleScreen(module: module)));
    }
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
                child: Image.asset('assets/logo.png', height: 30, semanticLabel: 'Premnath Rail'),
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 4, 20, 8),
              child: _Caps('NAVIGATION'),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.symmetric(horizontal: 12),
                children: [
                  _MenuItem(Icons.home_outlined, 'Dashboard',
                      selected: widget.current == null, onTap: () => _go(null)),
                  for (final m in live)
                    _MenuItem(m.icon, m.menuLabel, selected: widget.current == m, onTap: () => _go(m)),
                  if (upcoming.isNotEmpty) ...[
                    InkWell(
                      borderRadius: BorderRadius.circular(8),
                      onTap: () => setState(() => _upcomingOpen = !_upcomingOpen),
                      child: Padding(
                        padding: const EdgeInsets.fromLTRB(8, 14, 8, 8),
                        child: _Caps('${_upcomingOpen ? '▾' : '▸'}  UPCOMING (${upcoming.length})'),
                      ),
                    ),
                    if (_upcomingOpen)
                      for (final m in upcoming)
                        _MenuItem(m.icon, m.menuLabel, selected: widget.current == m, onTap: () => _go(m)),
                  ],
                ],
              ),
            ),
            const Divider(height: 1),
            _UserChip(user: widget.user),
          ],
        ),
      ),
    );
  }
}

class _Caps extends StatelessWidget {
  const _Caps(this.text, {this.color = Brand.muted});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Text(text,
      style: TextStyle(fontSize: 11, fontWeight: FontWeight.w600, letterSpacing: 0.9, color: color));
}

class _MenuItem extends StatelessWidget {
  const _MenuItem(this.icon, this.label, {required this.selected, required this.onTap});
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
                  child: Text(label,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                          fontSize: 14,
                          fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                          color: fg)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _initials(String name) {
  final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
  if (parts.isEmpty) return '?';
  return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
}

String _roleLabel(Map<String, dynamic> user) {
  final role = (user['role'] as String?) ?? '';
  if (role.isEmpty) return '';
  return role[0].toUpperCase() + role.substring(1);
}

class _UserChip extends StatelessWidget {
  const _UserChip({required this.user});
  final Map<String, dynamic> user;

  @override
  Widget build(BuildContext context) {
    final name = (user['name'] as String?) ?? '';
    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      leading: CircleAvatar(
        backgroundColor: Brand.primary,
        child: Text(_initials(name),
            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
      ),
      title: Text(name, style: const TextStyle(fontWeight: FontWeight.w700, color: Brand.heading)),
      subtitle: Text(_roleLabel(user), style: const TextStyle(color: Brand.muted, fontSize: 12)),
      trailing: const Icon(Icons.keyboard_arrow_up_rounded),
      onTap: () => showModalBottomSheet<void>(
        context: context,
        backgroundColor: Colors.transparent,
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
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(20)),
      child: SafeArea(
        top: false,
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
                    child: Text(_initials(name),
                        style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name,
                            style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w700, fontSize: 16)),
                        if (role.isNotEmpty) ...[
                          const SizedBox(height: 4),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 2),
                            decoration: BoxDecoration(
                                color: Colors.white.withValues(alpha: 0.12),
                                borderRadius: BorderRadius.circular(20)),
                            child: Text(role,
                                style: const TextStyle(color: Color(0xFFCBD5E1), fontSize: 11)),
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            ),
            _InfoRow(Icons.mail_outline_rounded, 'EMAIL', user['email']),
            _InfoRow(Icons.work_outline_rounded, 'DESIGNATION', user['designation']),
            _InfoRow(Icons.apartment_outlined, 'DEPARTMENT', user['department']),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
              child: OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Brand.danger,
                  backgroundColor: Brand.dangerSoft,
                  side: BorderSide(color: Brand.danger.withValues(alpha: 0.3)),
                  minimumSize: const Size.fromHeight(44),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                ),
                icon: const Icon(Icons.logout_rounded, size: 18),
                label: const Text('Logout', style: TextStyle(fontWeight: FontWeight.w600)),
                onPressed: () {
                  Navigator.of(context).popUntil((r) => r.isFirst);
                  AuthService.instance.signOut();
                },
              ),
            ),
          ],
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
    final text = value is String && (value as String).isNotEmpty ? value as String : '—';
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
                _Caps(label),
                const SizedBox(height: 2),
                Text(text,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(fontWeight: FontWeight.w600, color: Brand.heading)),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ── Dashboard ────────────────────────────────────────────────────────────────

const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _months = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

String _greeting(DateTime now) {
  if (now.hour < 12) return 'Good morning';
  if (now.hour < 17) return 'Good afternoon';
  return 'Good evening';
}

String _longDate(DateTime d) => '${_weekdays[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]} ${d.year}';

class _Dashboard extends StatefulWidget {
  const _Dashboard({required this.user, required this.modules});
  final Map<String, dynamic> user;
  final List<ErpModule> modules;

  @override
  State<_Dashboard> createState() => _DashboardState();
}

class _DashboardState extends State<_Dashboard> {
  bool _showUpcoming = false;

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    final first = ((widget.user['name'] as String?) ?? '').split(' ').first;
    final live = widget.modules.where((m) => !m.upcoming).toList();
    final upcoming = widget.modules.where((m) => m.upcoming).toList();
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 20, 16, 32),
      children: [
        Text(first.isEmpty ? _greeting(now) : '${_greeting(now)}, $first',
            style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w700, color: Brand.heading)),
        const SizedBox(height: 4),
        Text(_longDate(now), style: const TextStyle(fontSize: 14, color: Brand.muted)),
        const SizedBox(height: 24),
        const _Caps('YOUR APPLICATIONS'),
        const SizedBox(height: 12),
        if (live.isEmpty && upcoming.isEmpty) const _NoApplications(),
        for (final m in live) _ModuleCard(m),
        if (upcoming.isNotEmpty) ...[
          InkWell(
            onTap: () => setState(() => _showUpcoming = !_showUpcoming),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: _Caps('${_showUpcoming ? '▾' : '▸'}  COMING SOON (${upcoming.length})',
                  color: const Color(0xFF475569)),
            ),
          ),
          if (_showUpcoming)
            for (final m in upcoming) _ModuleCard(m),
        ],
      ],
    );
  }
}

class _NoApplications extends StatelessWidget {
  const _NoApplications();

  @override
  Widget build(BuildContext context) {
    return const Card(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 20, vertical: 28),
        child: Column(
          children: [
            Text('No applications assigned to you yet',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: Brand.heading)),
            SizedBox(height: 4),
            Text(
                'Ask your administrator to give you a role in Organization › Users — the modules you can use will then appear here and in the menu.',
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 12.5, color: Brand.muted)),
          ],
        ),
      ),
    );
  }
}

class _ModuleCard extends StatelessWidget {
  const _ModuleCard(this.module);
  final ErpModule module;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: () => _open(context, ModuleScreen(module: module)),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(14, 14, 12, 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: module.color.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(module.icon, size: 20, color: module.color),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(module.title,
                          style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Brand.heading)),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                Text(module.description,
                    style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF475569))),
                const SizedBox(height: 8),
                Align(
                  alignment: Alignment.centerRight,
                  child: Container(
                    width: 28,
                    height: 28,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(color: Colors.black.withValues(alpha: 0.12), blurRadius: 6, offset: const Offset(0, 2)),
                      ],
                    ),
                    child: const Icon(Icons.arrow_forward_rounded, size: 16, color: Brand.heading),
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

// ── Module screens ───────────────────────────────────────────────────────────

/// Entry screen of one module. Its native tabs and records are filled in
/// module by module, each copying the portal page at phone width.
class ModuleScreen extends StatelessWidget {
  const ModuleScreen({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) {
    final user = AuthService.instance.user ?? const <String, dynamic>{};
    return Scaffold(
      appBar: const _TopBar(),
      drawer: _AppMenu(user: user, modules: modulesFor(user), current: module),
      body: _Placeholder(module.icon, module.title,
          'The ${module.title} screens are being built for the app. Until then, use the portal for this module.'),
    );
  }
}

class _PlaceholderScreen extends StatelessWidget {
  const _PlaceholderScreen(this.icon, this.title, this.message);
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: _Placeholder(icon, title, message),
    );
  }
}

class _Placeholder extends StatelessWidget {
  const _Placeholder(this.icon, this.title, this.message);
  final IconData icon;
  final String title;
  final String message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 56, color: Brand.muted),
            const SizedBox(height: 16),
            Text(title, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center, style: const TextStyle(color: Brand.muted)),
          ],
        ),
      ),
    );
  }
}
