import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_capa.dart';
import 'quality_common.dart';
import 'quality_complaints.dart';
import 'quality_first_articles.dart';
import 'quality_in_process.dart';
import 'quality_inspection_calls.dart';
import 'quality_lots.dart';
import 'quality_ncr.dart';
import 'quality_supplier.dart';

enum _Tone { bad, warn, neutral }

class _Kpi {
  const _Kpi(this.key, this.label, this.tone, {this.target, this.pct = false});
  final String key;
  final String label;
  final _Tone tone;
  final String? target;
  final bool pct;
}

const _cards = [
  _Kpi('lots_waiting', 'Lots waiting', _Tone.neutral, target: 'my_inspections'),
  _Kpi('lots_overdue', 'Lots waiting too long', _Tone.bad, target: 'inspection_lots'),
  _Kpi('open_ncrs', 'Open NCRs', _Tone.warn, target: 'ncr'),
  _Kpi('critical_ncrs', 'Critical NCRs', _Tone.bad, target: 'ncr'),
  _Kpi('major_ncrs', 'Major NCRs', _Tone.warn, target: 'ncr'),
  _Kpi('minor_ncrs', 'Minor NCRs', _Tone.neutral, target: 'ncr'),
  _Kpi('ncrs_awaiting_approval', 'Dispositions awaiting approval', _Tone.warn, target: 'ncr'),
  _Kpi('month_rejection_rate', 'Rejection rate (this month)', _Tone.neutral, pct: true),
  _Kpi('open_capas', 'Open CAPAs', _Tone.warn, target: 'capa'),
  _Kpi('overdue_capas', 'Overdue CAPAs', _Tone.bad, target: 'capa'),
  _Kpi('open_complaints', 'Open Complaints', _Tone.warn, target: 'complaints'),
  _Kpi('gate_inspections_pending', 'In-process gates pending', _Tone.neutral, target: 'in_process_inspection'),
  _Kpi('open_first_articles', 'First articles open', _Tone.warn, target: 'first_article'),
  _Kpi('inspection_calls_next_7_days', 'Inspection calls (7 days)', _Tone.neutral, target: 'inspection_calls'),
  _Kpi('vendors_on_watch', 'Vendors on watch', _Tone.warn, target: 'supplier_quality'),
  _Kpi('vendors_blocked', 'Vendors blocked', _Tone.bad, target: 'supplier_quality'),
  _Kpi('vendor_blocks_pending', 'Vendor blocks awaiting Partner', _Tone.warn, target: 'supplier_quality'),
];

/// Opens the tab a KPI card points at (portal: router.push(card.href)).
Widget? _targetScreen(String key) {
  switch (key) {
    case 'my_inspections':
      return const LotsTab(mine: true);
    case 'inspection_lots':
      return const LotsTab();
    case 'ncr':
      return const NcrTab();
    case 'capa':
      return const CapaTab();
    case 'complaints':
      return const ComplaintsTab();
    case 'in_process_inspection':
      return const InProcessTab();
    case 'first_article':
      return const FirstArticlesTab();
    case 'inspection_calls':
      return const InspectionCallsTab();
    case 'supplier_quality':
      return const SupplierQualityTab();
  }
  return null;
}

/// Quality dashboard (portal quality/page.tsx).
class QualityDashboardTab extends StatelessWidget {
  const QualityDashboardTab({super.key});

  @override
  Widget build(BuildContext context) {
    final see = Perm.can('quality', 'dashboard', 'view');
    final dept = str(Perm.user['department']);
    final header = PageHeader('Quality',
        subtitle: '${dept.isNotEmpty ? '$dept — ' : ''}Inspection lots, NCRs and their dispositions, CAPA, complaints and supplier quality.');
    if (!see) {
      return ListView(children: [
        header,
        const Hint('The Quality dashboard needs \'View\' on Quality › Dashboard — ask an admin to add it to one of your roles '
            'in Organization › Role & Permissions. Your other Quality tabs are in the bar above.'),
      ]);
    }
    return ApiLoader<Json>(
      load: () async {
        final r = await Api.get('/quality/dashboard');
        return r is Map && r['kpis'] is Map ? Map<String, dynamic>.from(r['kpis'] as Map) : <String, dynamic>{};
      },
      builder: (ctx, kpis, reload) => ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          header,
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: GridView.count(
              crossAxisCount: 2,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 10,
              crossAxisSpacing: 10,
              childAspectRatio: 1.45,
              children: [for (final c in _cards) _card(ctx, c, kpis[c.key])],
            ),
          ),
        ],
      ),
    );
  }

  Widget _card(BuildContext context, _Kpi c, Object? value) {
    final (bg, border, fg) = switch (c.tone) {
      _Tone.bad => (Brand.danger.withValues(alpha: 0.08), Brand.danger.withValues(alpha: 0.2), Brand.danger),
      _Tone.warn => (Brand.warning.withValues(alpha: 0.08), Brand.warning.withValues(alpha: 0.2), const Color(0xFFD97706)),
      _Tone.neutral => (Colors.white, Brand.border, Brand.heading),
    };
    final target = c.target == null || !qualityTabVisible(c.target!) ? null : _targetScreen(c.target!);
    return Material(
      color: bg,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: border)),
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: target == null ? null : () => openScreen(context, SubPage(title: c.label, body: target)),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Caps(c.label),
              Text(value == null ? '—' : (c.pct ? '$value%' : '$value'),
                  style: TextStyle(fontSize: 26, fontWeight: FontWeight.w700, color: fg)),
            ],
          ),
        ),
      ),
    );
  }
}
