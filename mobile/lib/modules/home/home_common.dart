import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';

/// Small pieces shared by Alerts, My Approvals and My Tasks.

/// Horizontal row of clickable chips (portal tab buttons / count chips).
class ChipBar extends StatelessWidget {
  const ChipBar({super.key, required this.children, this.padding = const EdgeInsets.fromLTRB(16, 10, 16, 6)});
  final List<Widget> children;
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        scrollDirection: Axis.horizontal,
        padding: padding,
        child: Row(children: children),
      );
}

/// Coloured pill with a fixed colour (portal Pill / Chip).
class Pill extends StatelessWidget {
  const Pill(this.text, this.color, {super.key});
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(20)),
        child: Text(text, style: TextStyle(color: color, fontSize: 11.5, fontWeight: FontWeight.w600)),
      );
}

/// Thin progress bar with the percentage after it.
class ProgressLine extends StatelessWidget {
  const ProgressLine(this.percent, {super.key, this.color = const Color(0xFF2563EB)});
  final num percent;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final v = percent.clamp(0, 100).toDouble();
    return Row(
      children: [
        Expanded(
          child: ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: LinearProgressIndicator(
              value: v / 100,
              minHeight: 7,
              backgroundColor: const Color(0xFFE2E8F0),
              color: v >= 100 ? Brand.success : color,
            ),
          ),
        ),
        const SizedBox(width: 8),
        Text('${v.round()}%', style: const TextStyle(fontSize: 12.5, fontWeight: FontWeight.w700, color: Brand.heading)),
      ],
    );
  }
}

/// Info / hint card (portal muted helper text in a card).
class HintCard extends StatelessWidget {
  const HintCard(this.text, {super.key, this.title, this.color = Brand.muted});
  final String text;
  final String? title;
  final Color color;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 10),
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: Brand.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (title != null) ...[
                Text(title!, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: Brand.heading)),
                const SizedBox(height: 4),
              ],
              Text(text, style: TextStyle(fontSize: 12.5, color: color)),
            ],
          ),
        ),
      );
}

/// Group heading inside a list ("OVERDUE (3)").
class GroupHeading extends StatelessWidget {
  const GroupHeading(this.title, {super.key, this.color = Brand.muted});
  final String title;
  final Color color;

  @override
  Widget build(BuildContext context) =>
      Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 8), child: Caps(title, color: color));
}

/// Loads a value once (with reload) and shows loading / error / content,
/// with pull-to-refresh. For screens that filter rows on the phone.
class Loaded<T> extends StatefulWidget {
  const Loaded({super.key, required this.load, required this.builder});
  final Future<T> Function() load;
  final Widget Function(BuildContext context, T data, Future<void> Function() reload) builder;

  @override
  State<Loaded<T>> createState() => LoadedState<T>();
}

class LoadedState<T> extends State<Loaded<T>> {
  T? _data;
  Object? _error;
  bool _loading = true;
  int _token = 0;

  @override
  void initState() {
    super.initState();
    reload();
  }

  Future<void> reload() async {
    final t = ++_token;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await widget.load();
      if (!mounted || t != _token) return;
      setState(() {
        _data = d;
        _loading = false;
      });
    } catch (e) {
      if (!mounted || t != _token) return;
      setState(() {
        _error = e;
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_loading && _data == null) return const LoadingView();
    if (_error != null && _data == null) {
      return RefreshIndicator(
        onRefresh: reload,
        child: ListView(children: [ErrorView(_error!, onRetry: reload)]),
      );
    }
    return RefreshIndicator(
      onRefresh: reload,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_error != null)
            Padding(padding: const EdgeInsets.fromLTRB(16, 8, 16, 0), child: ErrorBanner(ApiClient.describe(_error!))),
          Expanded(child: widget.builder(context, _data as T, reload)),
        ],
      ),
    );
  }
}

/// Rows of a list response.
List<Json> rowsOf(dynamic data) => ApiPage.from(data).rows;

/// Today as yyyy-MM-dd (local, like the portal's todayIso()).
String todayIso() => apiDate(DateTime.now());

/// Whole days from today to [iso] (negative = past); null when empty.
int? daysFromToday(Object? iso) {
  final d = parseDate(iso);
  if (d == null) return null;
  final now = DateTime.now();
  return DateTime.utc(d.year, d.month, d.day).difference(DateTime.utc(now.year, now.month, now.day)).inDays;
}

/// Portal dueText(): "Overdue by 2 days" / "Due today" / "3 days left".
String dueText(Object? iso, {bool done = false}) {
  if (done) return 'Achieved';
  final n = daysFromToday(iso);
  if (n == null) return '';
  if (n < 0) return 'Overdue by ${-n} day${n == -1 ? '' : 's'}';
  if (n == 0) return 'Due today';
  return '$n day${n == 1 ? '' : 's'} left';
}

/// "today" / "3 days" since [iso].
String ageText(Object? iso) {
  final n = daysFromToday(iso);
  if (n == null) return '—';
  final d = -n;
  if (d <= 0) return 'today';
  return '$d day${d == 1 ? '' : 's'}';
}

bool truthy(Object? v) => v == true;

int asInt(Object? v) => v is int ? v : (v is num ? v.toInt() : int.tryParse('${v ?? ''}') ?? 0);

/// Project Management features (portal usePmFeature): they apply only to
/// people whose roles open the project workspace; for everyone else the
/// server's record rules (can_*) decide.
bool pmFeature(String feature, String action) {
  final pmRole = Perm.can('projects', 'overview', 'view');
  return !pmRole || Perm.canFeature('projects', 'overview', feature, action);
}
