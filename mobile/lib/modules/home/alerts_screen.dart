import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'alert_links.dart';
import 'home_common.dart';
import 'my_approvals_screen.dart';
import 'my_tasks_screen.dart';

/// Alerts - the portal's notification bell (NotificationBell.tsx): the last
/// 30 notifications newest first, unread ones highlighted, "Mark all read",
/// the On/Off switch for bell + Teams alerts. Tapping one marks it read and
/// opens its detail.
class AlertsScreen extends StatefulWidget {
  const AlertsScreen({super.key});

  @override
  State<AlertsScreen> createState() => _AlertsScreenState();
}

class _AlertsScreenState extends State<AlertsScreen> {
  List<Json> _rows = const [];
  int _unread = 0;
  bool _onlyUnread = false;
  bool _savingPref = false;

  bool get _enabled => Perm.user['notifications_enabled'] != false;

  Future<List<Json>> _load() async {
    final results = await Future.wait([
      Api.get('/notifications'),
      Api.get('/notifications/unread-count'),
    ]);
    final rows = rowsOf(results[0]);
    final c = results[1];
    _rows = rows;
    _unread = c is Map ? asInt(c['count']) : rows.where((n) => n['is_read'] != true).length;
    if (mounted) setState(() {});
    return rows;
  }

  Future<void> _markAllRead() async {
    final ok = await runAction(context, () => Api.patch('/notifications/read-all'), success: 'All notifications marked as read.');
    if (!ok || !mounted) return;
    setState(() {
      for (final n in _rows) {
        n['is_read'] = true;
      }
      _unread = 0;
    });
  }

  Future<void> _togglePref() async {
    if (_savingPref) return;
    setState(() => _savingPref = true);
    final next = !_enabled;
    await runAction(context, () async {
      final r = await Api.patch('/notifications/preferences', data: {'enabled': next});
      final user = Perm.user;
      // The signed-in user map is the app's copy of /auth/me - keep it in step.
      if (user.isNotEmpty) {
        user['notifications_enabled'] = r is Map ? r['notifications_enabled'] ?? next : next;
      }
    }, success: next ? 'Notifications turned on.' : 'Notifications turned off.');
    if (mounted) setState(() => _savingPref = false);
  }

  Future<void> _open(Json n) async {
    if (n['is_read'] != true) {
      try {
        await Api.patch('/notifications/${n['id']}/read');
        if (mounted) {
          setState(() {
            n['is_read'] = true;
            _unread = (_unread - 1).clamp(0, 1 << 30);
          });
        }
      } catch (e) {
        if (mounted) showSnack(context, ApiClient.describe(e), error: true);
      }
    }
    if (!mounted) return;
    openScreen(context, AlertDetailScreen(notification: n));
  }

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Notifications',
      actions: [
        if (_unread > 0)
          TextButton(onPressed: _markAllRead, child: const Text('Mark all read')),
        Padding(
          padding: const EdgeInsets.only(right: 8),
          child: OutlinedButton(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(48, 32),
              padding: const EdgeInsets.symmetric(horizontal: 10),
              foregroundColor: _enabled ? Brand.muted : const Color(0xFFA8A29E),
              side: const BorderSide(color: Brand.border),
            ),
            onPressed: _savingPref ? null : _togglePref,
            child: Text(_enabled ? 'On' : 'Off', semanticsLabel: _enabled ? 'Turn notifications off' : 'Turn notifications on'),
          ),
        ),
      ],
      body: Loaded<List<Json>>(
        load: _load,
        builder: (ctx, _, _) {
          final shown = _onlyUnread ? _rows.where((n) => n['is_read'] != true).toList() : _rows;
          return ListView(
            padding: const EdgeInsets.only(bottom: 32),
            children: [
              if (!_enabled)
                const HintCard("Notifications are turned off. You won't receive new alerts here or in Teams until you turn them back on."),
              ChipBar(children: [
                CountChip('All', _rows.length, selected: !_onlyUnread, onTap: () => setState(() => _onlyUnread = false)),
                CountChip('Unread', _unread,
                    selected: _onlyUnread, onTap: () => setState(() => _onlyUnread = !_onlyUnread)),
              ]),
              if (shown.isEmpty)
                EmptyView(_onlyUnread ? 'No unread notifications.' : 'No notifications yet.',
                    icon: Icons.notifications_none_rounded)
              else
                for (final n in shown) _AlertTile(n: n, onTap: () => _open(n)),
            ],
          );
        },
      ),
    );
  }
}

class _AlertTile extends StatelessWidget {
  const _AlertTile({required this.n, required this.onTap});
  final Json n;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final unread = n['is_read'] != true;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
      child: Material(
        color: unread ? const Color(0x0AF4713B) : Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
          side: BorderSide(color: unread ? Brand.primary.withValues(alpha: 0.35) : Brand.border),
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(14),
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 5, right: 10),
                  child: Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                        shape: BoxShape.circle, color: unread ? Brand.primary : Colors.transparent),
                  ),
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(txt(n['title']),
                          style: TextStyle(
                              fontSize: 14,
                              fontWeight: unread ? FontWeight.w700 : FontWeight.w600,
                              color: Brand.heading)),
                      if ('${n['message'] ?? ''}'.isNotEmpty) ...[
                        const SizedBox(height: 2),
                        Text('${n['message']}',
                            maxLines: 3,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 13, color: Brand.muted)),
                      ],
                      if (n['created_at'] != null) ...[
                        const SizedBox(height: 4),
                        Text(fmtDateTime(n['created_at']),
                            style: const TextStyle(fontSize: 11, color: Color(0xFFA8A29E))),
                      ],
                    ],
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

/// One notification: title, message, module, record, time, and where it
/// leads - My Approvals / My Tasks natively, anything else in the portal.
class AlertDetailScreen extends StatelessWidget {
  const AlertDetailScreen({super.key, required this.notification});
  final Json notification;

  @override
  Widget build(BuildContext context) {
    final n = notification;
    final link = alertLink(n);
    final native = link == myApprovalsPath || link == myTasksPath;
    final module = moduleOfLink(link);
    final entity = '${n['entity_type'] ?? ''}';
    return SubPage(
      title: 'Notification',
      body: ListView(
        padding: const EdgeInsets.only(top: 12, bottom: 32),
        children: [
          DetailSection(
            txt(n['title']),
            children: [
              if ('${n['message'] ?? ''}'.isNotEmpty) FieldRow('Message', n['message']),
              FieldRow('Received', fmtDateTime(n['created_at'])),
              FieldRow('Status', StatusBadge(n['is_read'] == true ? 'Read' : 'Unread',
                  color: n['is_read'] == true ? Brand.muted : Brand.primaryActive)),
            ],
          ),
          DetailSection(
            'Related record',
            children: [
              FieldRow('Module', module ?? '—'),
              FieldRow('Record', entity.isEmpty ? '—' : humanize(entity)),
              FieldRow('Type', humanize(n['notification_type'])),
              FieldRow('Opens', link ?? 'This notification has no page to open.'),
            ],
          ),
        ],
      ),
      bottom: link == null
          ? null
          : native
              ? FilledButton.icon(
                  icon: Icon(link == myApprovalsPath ? Icons.inbox_outlined : Icons.task_alt_rounded),
                  label: Text(link == myApprovalsPath ? 'Open My Approvals' : 'Open My Tasks'),
                  onPressed: () => openScreen(
                      context, link == myApprovalsPath ? const MyApprovalsScreen() : const MyTasksScreen()),
                )
              : OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                  icon: const Icon(Icons.open_in_new_rounded),
                  label: const Text('Open in portal'),
                  onPressed: () => runAction(context, () => Files.openInPortal(link)),
                ),
    );
  }
}
