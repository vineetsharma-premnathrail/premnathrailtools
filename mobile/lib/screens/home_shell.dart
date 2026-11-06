import 'package:flutter/material.dart';

import '../auth/auth_service.dart';
import '../modules.dart';
import '../theme.dart';
import '../ui/app_frame.dart';
import '../ui/widgets.dart';

/// Logged-in home = the portal Dashboard at phone width: top bar with the
/// menu and logo, the sidebar as a slide-in menu, "Your applications".
class HomeShell extends StatelessWidget {
  const HomeShell({super.key});

  @override
  Widget build(BuildContext context) {
    final user = AuthService.instance.user ?? const <String, dynamic>{};
    final modules = modulesFor(user);
    return Scaffold(
      appBar: const TopBar(),
      drawer: AppMenu(user: user, modules: modules, current: null),
      body: _Dashboard(user: user, modules: modules),
    );
  }
}

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
        const Caps('Your applications'),
        const SizedBox(height: 12),
        if (live.isEmpty && upcoming.isEmpty) const _NoApplications(),
        for (final m in live) _ModuleCard(m),
        if (upcoming.isNotEmpty) ...[
          InkWell(
            onTap: () => setState(() => _showUpcoming = !_showUpcoming),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 18),
              child: Caps('${_showUpcoming ? '▾' : '▸'}  Coming soon (${upcoming.length})',
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
          onTap: () => openScreen(context, module.screen(module)),
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
                Text(module.description, style: const TextStyle(fontSize: 13, height: 1.4, color: Color(0xFF475569))),
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
