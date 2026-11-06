import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';

/// Timeline of an R&D requirement or Prototype / Research project - read only,
/// newest first (portal: RndProjectHistory).
class RndTimeline extends StatelessWidget {
  const RndTimeline({super.key, required this.path, this.errorPrefix});

  /// GET endpoint of the history list.
  final String path;
  final String? errorPrefix;

  static const _kinds = <String, (String, String)>{
    'milestone': ('Milestone', '#2563EB'),
    'task': ('Task', '#7C3AED'),
    'project': ('Project', '#78716c'),
    'requirement': ('Requirement', '#78716c'),
    'revision': ('Revision', '#2563EB'),
    'review': ('Review', '#16A34A'),
    'response': ('Response', '#0D9488'),
    'offer': ('Technical Offer', '#D97706'),
    'document': ('Document', '#475569'),
  };

  @override
  Widget build(BuildContext context) {
    return ApiLoader<List<Json>>(
      load: () async => jsonList(await Api.get(path)),
      builder: (ctx, entries, reload) {
        if (entries.isEmpty) {
          return ListView(children: const [EmptyView('Nothing on the timeline yet.', icon: Icons.history_rounded)]);
        }
        return ListView.builder(
          padding: const EdgeInsets.only(top: 12, bottom: 24),
          itemCount: entries.length,
          itemBuilder: (ctx, i) {
            final e = entries[i];
            final kind = str(e, 'kind') ?? '';
            final k = _kinds[kind] ?? (humanize(kind), '#78716c');
            return Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 10),
              child: Card(
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(
                            child: Text(
                              str(e, 'performed_by') ?? '—',
                              style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.heading),
                            ),
                          ),
                          const SizedBox(width: 8),
                          Pill(k.$1, hexColor(k.$2)),
                          const Spacer(),
                          Text(fmtDateTime(e['performed_at']), style: const TextStyle(fontSize: 11.5, color: Brand.muted)),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(str(e, 'summary') ?? '', style: const TextStyle(fontSize: 13, color: Brand.body)),
                    ],
                  ),
                ),
              ),
            );
          },
        );
      },
    );
  }
}
