import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'hyd_bom.dart';
import 'hyd_calculations.dart';
import 'hyd_circuits.dart';
import 'hyd_common.dart';
import 'hyd_components.dart';
import 'hyd_systems.dart';
import 'hyd_testing.dart';

// Portal: /dashboard/hydraulic (page.tsx).

class HydDashboard extends StatelessWidget {
  const HydDashboard({super.key});

  @override
  Widget build(BuildContext context) {
    return ApiLoader<Json>(
      load: () async => asJson(await Api.get('/hydraulic/dashboard')),
      builder: (ctx, data, reload) {
        final k = data['kpis'] is Map ? Map<String, dynamic>.from(data['kpis'] as Map) : <String, dynamic>{};
        int n(String key) => toInt(k[key]) ?? 0;
        final totalSystems = n('hydraulic_systems') + n('pneumatic_systems');
        final tests = rowsOf(data['recent_tests']);
        void go(String title, Widget list) => pushPage(ctx, ListSubPage(title: title, child: list)).then((_) => reload());
        final canCreate = hydCan('systems', 'create');
        return ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            PageHeader('Hydraulic & Pneumatic Dashboard', subtitle: 'Hydraulic & Pneumatic', actions: const []),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Row(children: [
                Expanded(child: secondaryBtn('Calculator', () => pushPage(ctx, const HydCalculator()))),
                if (canCreate) ...[
                  const SizedBox(width: 8),
                  Expanded(
                      child: primaryBtn('+ New System', () async {
                    await openSystemForm(ctx);
                    reload();
                  })),
                ],
              ]),
            ),
            if (totalSystems == 0)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      const Text(
                          'Add your first system — a hydraulic power pack or pneumatic unit — then attach its circuits, BOM and tests to it.',
                          style: TextStyle(fontSize: 13.5, color: Brand.body)),
                      if (canCreate)
                        linkBtn('+ Add your first system', () async {
                          await openSystemForm(ctx);
                          reload();
                        }),
                    ]),
                  ),
                ),
              ),
            const Padding(padding: EdgeInsets.fromLTRB(16, 4, 16, 8), child: Caps('Systems')),
            _grid([
              _Kpi('Hydraulic Systems', '${n('hydraulic_systems')}', hex: '#0369a1',
                  onTap: () => go('Systems', const HydSystemsList())),
              _Kpi('Pneumatic Systems', '${n('pneumatic_systems')}', hex: '#7C3AED',
                  onTap: () => go('Systems', const HydSystemsList())),
              _Kpi('In Service', '${n('in_service')}',
                  sub: 'Commissioned or in service',
                  hex: n('in_service') > 0 ? '#16A34A' : null,
                  onTap: () => go('Systems', const HydSystemsList())),
            ]),
            const Padding(padding: EdgeInsets.fromLTRB(16, 8, 16, 8), child: Caps('Quality & Design')),
            _grid([
              _Kpi('Tests (30 days)', '${n('tests_30d')}',
                  sub: n('tests_failed_30d') > 0 ? '${n('tests_failed_30d')} failed' : 'None failed',
                  hex: n('tests_failed_30d') > 0 ? '#DC2626' : null,
                  onTap: () => go('Testing & Inspection', const HydTestsList())),
              _Kpi('Circuits in Review', '${n('circuits_in_review')}',
                  hex: n('circuits_in_review') > 0 ? '#F59E0B' : null,
                  onTap: () => go('Circuits', const HydCircuitsList())),
              _Kpi('Draft BOMs', '${n('draft_boms')}', onTap: () => go('Bills of Material', const HydBomList())),
              _Kpi('Component Master', '${n('active_components')}',
                  sub: 'Active components', onTap: () => go('Component Master', const HydComponentsList())),
            ]),
            DetailSection('Recent tests', children: [
              if (tests.isEmpty)
                Hint(totalSystems == 0
                    ? 'Add your first system, then record its pressure, leak and functional tests.'
                    : 'No tests yet — plan a test from the Testing tab.'),
              for (final t in tests)
                MiniRow(
                  code: txt(t['test_number']),
                  title: txt(t['title']),
                  meta: '${lbl(testTypeLabels, t['test_type'])} · ${fmtDate(t['test_date'])}',
                  badge: t['status'] == 'completed'
                      ? pill(resultLabels, resultHex, t['result'])
                      : pill(const {'planned': 'Planned', 'in_progress': 'In Progress', 'under_review': 'Awaiting Sign-off'},
                          const {'planned': '#78716c', 'in_progress': '#2563EB', 'under_review': '#9333EA'}, t['status']),
                  onTap: () => pushPage(ctx, HydTestDetail(id: toInt(t['test_id'])!)).then((_) => reload()),
                ),
            ]),
          ],
        );
      },
    );
  }

  Widget _grid(List<Widget> cards) => Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
        child: GridView.count(
          crossAxisCount: 2,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 10,
          crossAxisSpacing: 10,
          childAspectRatio: 1.45,
          children: cards,
        ),
      );
}

class _Kpi extends StatelessWidget {
  const _Kpi(this.label, this.value, {this.sub, this.hex, this.onTap});
  final String label;
  final String value;
  final String? sub;
  final String? hex;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) => Card(
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
              Caps(label),
              const SizedBox(height: 4),
              Text(value,
                  style: TextStyle(fontSize: 24, fontWeight: FontWeight.w700, color: hex == null ? Brand.heading : hx(hex))),
              if (sub != null) Text(sub!, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12, color: Brand.muted)),
            ]),
          ),
        ),
      );
}
