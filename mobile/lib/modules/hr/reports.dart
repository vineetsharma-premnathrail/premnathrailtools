import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/reports/page.tsx — statutory registers per plant
// (Word document of record + Excel soft copy) and headcount on a date.

class HrReportsPage extends StatefulWidget {
  const HrReportsPage({super.key});

  @override
  State<HrReportsPage> createState() => _HrReportsPageState();
}

class _HrReportsPageState extends State<HrReportsPage> {
  List<Json> _types = [];
  List<Option<int>> _plants = [];
  int _rev = 0;
  String? _notice;
  DateTime _asOf = DateTime.now();
  Json? _headcount;

  @override
  void initState() {
    super.initState();
    Api.list('/hr/registers/types').then((p) { if (mounted) setState(() => _types = p.rows); }, onError: (_) {});
    Api.get('/hr/attendance/lookups').then((l) {
      if (mounted) setState(() => _plants = [for (final b in rowsOf(mapOf(l)['branches'])) Option(asInt(b['id']) ?? 0, str(b['name']))]);
    }, onError: (_) {});
  }

  Future<void> _generate() async {
    var type = _types.isEmpty ? 'form25' : str(_types.first['key']);
    int? plant;
    var year = DateTime.now().year;
    var month = DateTime.now().month == 1 ? 12 : DateTime.now().month - 1;
    Json? r;
    final ok = await showFormSheet(context,
        title: 'Generate register',
        saveLabel: 'Generate',
        builder: (ctx, setS) {
          final monthly = _types.where((t) => t['key'] == type).firstOrNull?['monthly'] == true;
          return [
            AppSelect<String>(label: 'Register', value: type, clearable: false,
                options: [for (final t in _types) Option(str(t['key']), str(t['label']))], onChanged: (o) => setS(() => type = o?.value ?? type)),
            AppSelect<int>(label: 'Plant', required: true, value: plant, options: _plants, onChanged: (o) => setS(() => plant = o?.value)),
            AppSelect<int>(label: 'Year', value: year, clearable: false, options: yearOptions(), onChanged: (o) => setS(() => year = o?.value ?? year)),
            if (monthly)
              AppSelect<int>(label: 'Month', value: month, clearable: false,
                  options: [for (var i = 1; i <= 12; i++) Option(i, monthNames[i - 1])], onChanged: (o) => setS(() => month = o?.value ?? month)),
          ];
        },
        onSave: () async {
          if (plant == null) throw 'Pick the plant the register is for.';
          final monthly = _types.where((t) => t['key'] == type).firstOrNull?['monthly'] == true;
          r = mapOf(await Api.post('/hr/registers', data: {'register_type': type, 'branch_id': plant, 'year': year, 'month': monthly ? month : 0}));
        });
    if (ok && r != null && mounted) {
      setState(() {
        _notice = '${r!['register_label']} ready for ${r!['branch_name']}, ${r!['period']}. Open it in Word to review, sign and print.';
        _rev++;
      });
    }
  }

  Future<void> _loadHeadcount() async {
    try {
      final h = mapOf(await Api.get('/hr/org-assignments/as-of', query: {'date': apiDate(_asOf)}));
      if (mounted) setState(() => _headcount = h);
    } catch (e) {
      if (mounted) showSnack(context, "Couldn't load the headcount: ${ApiClient.describe(e)}", error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canExport = Perm.can('hr', 'reports', 'export');
    return ApiListView(
      key: ValueKey('regs$_rev'),
      load: (_, _) => Api.list('/hr/registers'),
      emptyText: 'No register generated yet.',
      header: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        PageHeader('Statutory registers & reports',
            subtitle: 'Factories Act registers per plant, built from attendance, leave and approved overtime. The Word document is the register of record.',
            actions: [if (Perm.can('hr', 'reports', 'print')) headerButton('Generate', _generate)]),
        if (_notice != null) padded(NoticeBanner(_notice!)),
        DetailSection('Headcount on a date', children: [
          const HintText('From the assignment history (who was in which department on that day).'),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: DateField(label: 'As on', required: true, value: _asOf, onChanged: (d) { if (d != null) setState(() => _asOf = d); })),
            const SizedBox(width: 8),
            headerButton('Show', _loadHeadcount, primary: false),
          ]),
          if (_headcount != null)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text('${numTxt(_headcount!['total'])} employee(s): '
                  '${mapOf(_headcount!['by_department']).entries.map((e) => '${e.key} ${e.value}').join(' · ').isEmpty ? '—' : mapOf(_headcount!['by_department']).entries.map((e) => '${e.key} ${e.value}').join(' · ')}'),
            ),
        ]),
        const BlockTitle('Registers'),
      ]),
      itemBuilder: (ctx, r, reload) => RecordCard(
        title: '${r['register_label']}${toNum(r['revision']) > 0 ? ' (rev ${r['revision']})' : ''}',
        subtitle: '${r['branch_name']} · ${r['period']}',
        meta: [('Generated', '${str(r['generated_by_name']).isEmpty ? '—' : r['generated_by_name']}${str(r['generated_at']).isEmpty ? '' : ' · ${fmtDate(r['generated_at'])}'}')],
        onTap: () => showModalBottomSheet<void>(
          context: context,
          builder: (_) => SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: actionRow([
                LinkAction('Word document', () {
                  Navigator.pop(context);
                  openPortal(context, '/dashboard/hr/reports');
                }),
                if (canExport)
                  LinkAction('Excel', () {
                    Navigator.pop(context);
                    openApiFile(context, '/hr/registers/${r['id']}/xlsx', '${r['register_type']}_${r['branch_name']}_${r['year']}${toNum(r['month']) > 0 ? '_${r['month']}' : ''}.xlsx');
                  }),
              ]),
            ),
          ),
        ),
      ),
    );
  }
}