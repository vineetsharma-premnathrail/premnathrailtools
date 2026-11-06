import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'quality_common.dart';

const _stateLabels = <String, String>{
  'ok': 'In calibration',
  'due_soon': 'Due soon',
  'overdue': 'Overdue',
  'never_calibrated': 'Never calibrated',
  'blocked': 'Blocked',
};
const _stateHex = <String, Color>{
  'ok': Color(0xFF16A34A),
  'due_soon': Color(0xFFF59E0B),
  'overdue': Color(0xFFDC2626),
  'never_calibrated': Color(0xFF78716C),
  'blocked': Color(0xFFDC2626),
};
const _statusLabels = <String, String>{'active': 'Active', 'out_of_calibration': 'Out of calibration', 'scrapped': 'Scrapped'};
const _resultLabels = <String, String>{'pass': 'Pass', 'adjusted': 'Adjusted & pass', 'fail': 'Fail'};

String? _t(TextEditingController c) => c.text.trim().isEmpty ? null : c.text.trim();

/// Gauges & Test Equipment register (portal gauges/page.tsx).
class GaugesTab extends StatefulWidget {
  const GaugesTab({super.key});

  @override
  State<GaugesTab> createState() => _GaugesTabState();
}

class _GaugesTabState extends State<GaugesTab> {
  final _listKey = GlobalKey<ApiListViewState>();

  bool get _canCreate => Perm.can('quality', 'masters', 'create');
  bool get _canCalibrate => Perm.canFeature('quality', 'masters', 'calibration', 'create');
  bool get _seeHistory =>
      !Perm.can('quality', 'masters', 'view') || Perm.canFeature('quality', 'masters', 'calibration', 'view');

  Future<void> _register() async {
    final code = TextEditingController();
    final name = TextEditingController();
    final type = TextEditingController();
    final make = TextEditingController();
    final serial = TextEditingController();
    final location = TextEditingController();
    final range = TextEditingController();
    final least = TextEditingController();
    final interval = TextEditingController(text: '365');
    final cert = TextEditingController();
    DateTime? last;
    final ok = await showFormSheet(
      context,
      title: 'Register Gauge',
      saveLabel: 'Register',
      builder: (ctx, setS) => [
        const Text('Add a measuring instrument to the calibration register.',
            style: TextStyle(fontSize: 13, color: Brand.muted)),
        const Caps('Instrument'),
        AppTextField(label: 'Code', required: true, controller: code, hint: 'VC-012'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'Vernier caliper 0-150 mm'),
        AppTextField(label: 'Gauge type', controller: type, hint: 'Vernier caliper'),
        AppTextField(label: 'Make', controller: make),
        AppTextField(label: 'Serial no.', controller: serial),
        AppTextField(label: 'Location', controller: location),
        AppTextField(label: 'Range', controller: range),
        AppTextField(label: 'Least count', controller: least),
        const Caps('Calibration'),
        AppTextField(label: 'Interval (days)', required: true, controller: interval, keyboardType: TextInputType.number),
        DateField(label: 'Last calibrated', value: last, onChanged: (d) => setS(() => last = d)),
        AppTextField(label: 'Certificate ref', controller: cert),
        const Text(
            'The next due date is the last calibration plus the interval; a gauge never calibrated cannot be used for results.',
            style: TextStyle(fontSize: 12, color: Brand.muted)),
      ],
      onSave: () async {
        if (code.text.trim().isEmpty || name.text.trim().isEmpty) throw 'Gauge code and name are required.';
        final days = int.tryParse(interval.text.trim());
        if (days == null || days <= 0) throw 'Calibration interval must be at least 1 day.';
        await Api.post('/quality/gauges', data: {
          'code': _t(code),
          'name': _t(name),
          'gauge_type': _t(type),
          'make': _t(make),
          'serial_number': _t(serial),
          'measuring_range': _t(range),
          'least_count': _t(least),
          'location': _t(location),
          'calibration_interval_days': days,
          'last_calibrated_on': last == null ? null : apiDate(last!),
          'certificate_ref': _t(cert),
        });
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Gauge registered.');
      _listKey.currentState?.reload();
    }
  }

  Future<void> _calibrate(Json g) async {
    DateTime? on;
    var result = 'pass';
    DateTime? next;
    final agency = TextEditingController(text: str(g['calibration_agency']));
    final cert = TextEditingController();
    final remarks = TextEditingController();
    final ok = await showFormSheet(
      context,
      title: 'Record Calibration',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        Text('${txt(g['code'])} — ${txt(g['name'])}', style: const TextStyle(color: Brand.muted)),
        DateField(label: 'Calibrated on', required: true, value: on, onChanged: (d) => setS(() => on = d)),
        AppSelect<String>(
          label: 'Result',
          required: true,
          value: result,
          options: [for (final e in _resultLabels.entries) Option(e.key, e.value)],
          onChanged: (o) => setS(() => result = o?.value ?? result),
        ),
        if (result != 'fail') ...[
          DateField(label: 'Next due', value: next, onChanged: (d) => setS(() => next = d)),
          const Text('Leave blank to use the gauge\'s calibration interval.',
              style: TextStyle(fontSize: 12, color: Brand.muted)),
        ],
        AppTextField(label: 'Agency / lab', controller: agency),
        AppTextField(label: 'Certificate ref', controller: cert),
        AppTextField(label: 'Remarks', controller: remarks),
        if (result == 'fail')
          const Text('A failed calibration blocks the gauge for results recording until it passes a calibration.',
              style: TextStyle(fontSize: 12.5, color: Color(0xFFB91C1C))),
      ],
      onSave: () async {
        if (on == null) throw 'Enter the calibration date.';
        await Api.post('/quality/gauges/${g['id']}/calibrations', data: {
          'calibrated_on': apiDate(on!),
          'result': result,
          'next_due_on': result != 'fail' && next != null ? apiDate(next!) : null,
          'agency': _t(agency),
          'certificate_ref': _t(cert),
          'remarks': _t(remarks),
        });
      },
    );
    if (ok && mounted) {
      showSnack(context, 'Calibration recorded.');
      _listKey.currentState?.reload();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.transparent,
      floatingActionButton: _canCreate ? CreateFab(label: 'Register Gauge', onPressed: _register) : null,
      body: ApiListView(
        key: _listKey,
        searchHint: 'Search code, name, serial…',
        load: (page, search) => Api.list('/quality/gauges', query: {'search': search}),
        header: const Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          PageHeader('Gauges & Test Equipment', subtitle: 'Quality Module · Calibration control'),
          Hint('Inspection results can only be recorded with an active instrument that is within its calibration due date. '
              'Gauges falling due are reminded daily to their custodian (or the quality engineers).'),
        ]),
        emptyText: 'No gauges registered yet.',
        itemBuilder: (ctx, g, reload) => RecordCard(
          code: str(g['code']),
          title: txt(g['name']),
          subtitle: str(g['serial_number']).isEmpty ? null : 'S/N ${g['serial_number']}',
          trailing: Padding(
            padding: const EdgeInsets.only(left: 8),
            child: StatusBadge(_stateLabels[str(g['calibration_state'])] ?? humanize(g['calibration_state']),
                color: _stateHex[str(g['calibration_state'])] ?? qGrey),
          ),
          meta: [
            ('Type', txt(g['gauge_type'])),
            ('Location', txt(g['location'])),
            ('Last calibrated', fmtDate(g['last_calibrated_on'])),
            ('Next due', fmtDate(g['next_due_on'])),
            ('Status', lbl(_statusLabels, g['status'])),
            if (str(g['blocked_reason']).isNotEmpty) ('Blocked', str(g['blocked_reason'])),
          ],
          onTap: () {
            showModalBottomSheet<void>(
              context: ctx,
              backgroundColor: Colors.white,
              builder: (sheet) => SafeArea(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  ListTile(
                    title: Text('${txt(g['code'])} — ${txt(g['name'])}',
                        style: const TextStyle(fontWeight: FontWeight.w700)),
                  ),
                  if (_seeHistory)
                    ListTile(
                      leading: const Icon(Icons.history_rounded),
                      title: const Text('Calibration history'),
                      onTap: () {
                        Navigator.pop(sheet);
                        openScreen(ctx, _GaugeHistoryScreen(id: asInt(g['id'])!));
                      },
                    ),
                  if (_canCalibrate && g['status'] != 'scrapped')
                    ListTile(
                      leading: const Icon(Icons.event_available_outlined, color: Color(0xFF2563EB)),
                      title: const Text('Record calibration'),
                      onTap: () {
                        Navigator.pop(sheet);
                        _calibrate(g);
                      },
                    ),
                ]),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _GaugeHistoryScreen extends StatelessWidget {
  const _GaugeHistoryScreen({required this.id});
  final int id;

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'Calibration History',
      body: ApiLoader<Json>(
        load: () async => Map<String, dynamic>.from(await Api.get('/quality/gauges/$id') as Map),
        builder: (ctx, g, reload) {
          final cals = rowsOf(g['calibrations']);
          return ListView(
            padding: const EdgeInsets.only(top: 12, bottom: 32),
            children: [
              Hint('${txt(g['code'])} — ${txt(g['name'])}'),
              if (str(g['blocked_reason']).isNotEmpty)
                Hint(str(g['blocked_reason']), color: const Color(0xFFB91C1C)),
              if (cals.isEmpty) const EmptyView('No calibrations recorded.'),
              for (final c in cals)
                RecordCard(
                  title: fmtDate(c['calibrated_on']),
                  trailing: Padding(
                    padding: const EdgeInsets.only(left: 8),
                    child: StatusBadge(lbl(_resultLabels, c['result']), color: c['result'] == 'fail' ? qRed : qGreen),
                  ),
                  meta: [
                    ('Next due', fmtDate(c['next_due_on'])),
                    ('Agency', txt(c['agency'])),
                    ('Certificate', txt(c['certificate_ref'])),
                    ('Remarks', txt(c['remarks'])),
                  ],
                ),
            ],
          );
        },
      ),
    );
  }
}
