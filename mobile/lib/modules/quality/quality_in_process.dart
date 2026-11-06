import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';
import 'quality_final_inspection.dart';
import 'quality_lots.dart';

/// In-process (portal in-process-inspection/page.tsx): the in-process lots
/// (LotList type in_process, "+ Manual Lot") and, below, "Earlier gate
/// inspections" (old free-text records). On the phone the two lists sit
/// under two tabs.
class InProcessTab extends StatelessWidget {
  const InProcessTab({super.key});

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 2,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const PageHeader('In-process Inspections', subtitle: 'Quality Module'),
          const Hint('Production routing steps marked “inspection required” raise an in-process lot when the shop floor '
              'clicks Request Inspection. The next operation stays on hold until the lot’s usage decision.'),
          const TabBar(
            labelColor: Brand.primaryActive,
            indicatorColor: Brand.primary,
            unselectedLabelColor: Brand.muted,
            tabs: [Tab(text: 'In-process lots'), Tab(text: 'Earlier gate inspections')],
          ),
          const Expanded(
            child: TabBarView(children: [
              LotsTab(initialType: 'in_process'),
              _EarlierGateInspections(),
            ]),
          ),
        ],
      ),
    );
  }
}

class _EarlierGateInspections extends StatefulWidget {
  const _EarlierGateInspections();

  @override
  State<_EarlierGateInspections> createState() => _EarlierGateInspectionsState();
}

class _EarlierGateInspectionsState extends State<_EarlierGateInspections> {
  String _status = '';
  final _listKey = GlobalKey<ApiListViewState>();

  @override
  Widget build(BuildContext context) {
    return ApiListView(
      key: _listKey,
      searchHint: 'Search by inspection #, item, batch, or project…',
      load: (page, search) => Api.list('/quality/inspections',
          query: {'inspection_type': 'in_process', 'status': _status, 'search': search}),
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Hint('Free-text gate inspections raised before inspection lots existed. Kept for history; any still '
            'pending can be finished here and still release their production step.',
            padding: EdgeInsets.fromLTRB(16, 12, 16, 8)),
        FilterSelect(
          label: 'Status',
          allLabel: 'All statuses',
          value: _status,
          options: inspectionStatusLabels,
          onChanged: (v) {
            setState(() => _status = v);
            _listKey.currentState?.reload();
          },
        ),
      ]),
      emptyText: 'No in-process inspections found.',
      itemBuilder: (ctx, insp, reload) => inspectionCard(ctx, insp, reload, 'in_process'),
    );
  }
}
