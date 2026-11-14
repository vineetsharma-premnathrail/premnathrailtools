import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/safety (list, new, [id]) + components/hr/safety/*

const _statusLabels = {
  'reported': 'Reported', 'under_investigation': 'Under investigation', 'actions_open': 'Actions open',
  'closure_pending': 'Closure pending', 'closed': 'Closed',
};
const _statusHex = {'reported': '#DC2626', 'under_investigation': '#F59E0B', 'actions_open': '#2563EB', 'closure_pending': '#7C3AED', 'closed': '#16A34A'};
const _sevLabels = {'low': 'Low', 'medium': 'Medium', 'high': 'High', 'fatal': 'Fatal'};
const _sevHex = {'low': '#16A34A', 'medium': '#F59E0B', 'high': '#EA580C', 'fatal': '#991B1B'};
const _typeLabels = {
  'near_miss': 'Near miss', 'first_aid': 'First-aid case', 'injury_no_lost_time': 'Injury — no lost time',
  'injury_lost_time': 'Injury — lost time (LTI)', 'fatality': 'Fatality', 'dangerous_occurrence': 'Dangerous occurrence',
  'property_damage': 'Property damage', 'fire': 'Fire', 'environmental': 'Environmental',
};

List<Option<String>> _opts(Json meta, String key) => [for (final o in rowsOf(meta[key])) Option(str(o['value']), str(o['label']))];

/// One injured / involved person (portal PersonFields).
class _Person {
  var type = 'employee';
  int? userId;
  final name = TextEditingController(), company = TextEditingController(), age = TextEditingController(), occupation = TextEditingController();
  var outcome = 'first_aid';
  final injury = TextEditingController(), body = TextEditingController(), treatment = TextEditingController(), lostDays = TextEditingController(text: '0');
  DateTime? back;
  Map<String, dynamic> payload() => {
        'person_type': type,
        'user_id': type == 'employee' ? userId : null,
        'external_name': type == 'employee' ? null : textOrNull(name.text),
        'external_company': type == 'employee' ? null : textOrNull(company.text),
        'age': int.tryParse(age.text.trim()),
        'occupation': textOrNull(occupation.text),
        'outcome': outcome,
        'injury_nature': textOrNull(injury.text),
        'body_part': textOrNull(body.text),
        'treatment': textOrNull(treatment.text),
        'lost_days': outcome == 'lost_time' ? (int.tryParse(lostDays.text.trim()) ?? 0) : 0,
        'return_to_work_date': isoOrNull(back),
      };
}

/// Report an incident. Returns the new incident or null.
Future<Json?> showReportIncident(BuildContext context) async {
  Json meta;
  try {
    meta = mapOf(await Api.get('/hr/safety/meta'));
  } catch (e) {
    if (context.mounted) showSnack(context, ApiClient.describe(e), error: true);
    return null;
  }
  if (!context.mounted) return null;
  final title = TextEditingController();
  var type = 'near_miss';
  var sev = 'low';
  DateTime? date = DateTime.now();
  String? time;
  final desc = TextEditingController(), action = TextEditingController(), place = TextEditingController();
  int? branch = asInt(Perm.user['branch_id']);
  int? dept, asset, project;
  final persons = <_Person>[];
  final witnesses = <(TextEditingController, TextEditingController)>[];
  final files = <MultipartFile>[];
  final employees = [for (final u in rowsOf(meta['employees'])) Option(asInt(u['id']) ?? 0, str(u['name']), subtitle: str(u['email']))];
  Json? created;
  final ok = await showFormSheet(context,
      title: 'Report an incident',
      saveLabel: 'Report incident',
      builder: (ctx, setS) => [
            const HintText('Report every accident, near miss, dangerous occurrence and first-aid case as soon as the area is safe. The plant head and the EHS team are alerted; a high or fatal incident also alerts the Partners.'),
            const Caps('What Happened'),
            AppTextField(label: 'Title', controller: title, required: true, hint: 'e.g. Hand caught in press brake'),
            AppSelect<String>(label: 'Type', required: true, value: type, options: _opts(meta, 'incident_types'), onChanged: (o) => setS(() => type = o?.value ?? type)),
            AppSelect<String>(label: 'Severity', required: true, value: sev, options: _opts(meta, 'severities'), onChanged: (o) => setS(() => sev = o?.value ?? sev)),
            DateField(label: 'Date', required: true, value: date, lastDate: DateTime.now(), onChanged: (d) => setS(() => date = d)),
            TimeField(label: 'Time', required: true, value: time, onChanged: (t) => setS(() => time = t)),
            AppTextField(label: 'Description', controller: desc, required: true, maxLines: 4, hint: 'What was being done, what went wrong, what happened next…'),
            AppTextField(label: 'Immediate action taken', controller: action, maxLines: 3, hint: 'First aid, hospital, machine isolated, area barricaded…'),
            const Caps('Where'),
            AppSelect<int>(label: 'Plant (blank = customer site / other)', value: branch,
                options: [for (final b in rowsOf(meta['branches'])) Option(asInt(b['id']) ?? 0, str(b['name']))], onChanged: (o) => setS(() => branch = o?.value)),
            AppSelect<int>(label: 'Department', value: dept,
                options: [for (final d in rowsOf(meta['departments'])) if (branch == null || d['branch_id'] == null || d['branch_id'] == branch) Option(asInt(d['id']) ?? 0, str(d['name']))],
                onChanged: (o) => setS(() => dept = o?.value)),
            AppTextField(label: 'Exact place', controller: place, hint: 'e.g. Fabrication bay 2, near CNC-04'),
            const Caps('Equipment (optional)'),
            AppSelect<int>(label: 'Machine / equipment involved', value: asset,
                options: [for (final a in rowsOf(meta['assets'])) Option(asInt(a['id']) ?? 0, str(a['label']))], onChanged: (o) => setS(() => asset = o?.value)),
            AppSelect<int>(label: 'Customer machine (site incident)', value: project,
                options: [for (final p in rowsOf(meta['projects'])) Option(asInt(p['id']) ?? 0, str(p['label']))], onChanged: (o) => setS(() => project = o?.value)),
            const Caps('Photos / Documents (optional)'),
            Wrap(spacing: 4, children: [
              LinkAction('Take photo', () async { final f = await Files.takePhoto(); if (f != null) setS(() => files.add(f)); }),
              LinkAction('Choose files', () async { final f = await Files.pickFiles(); setS(() => files.addAll(f)); }),
            ]),
            if (files.isNotEmpty) HintText('${files.length} file(s) — uploaded after the report is saved.'),
            const Caps('Persons Injured / Involved'),
            if (persons.isEmpty) const HintText('Nobody hurt (near miss / property damage)? Leave this empty.'),
            for (var i = 0; i < persons.length; i++) ...[
              Row(children: [
                Expanded(child: Text('Person ${i + 1}', style: const TextStyle(fontWeight: FontWeight.w700))),
                LinkAction('Remove', () => setS(() => persons.removeAt(i)), color: Brand.danger),
              ]),
              AppSelect<String>(label: 'Category', value: persons[i].type, clearable: false, options: _opts(meta, 'person_types'), onChanged: (o) => setS(() => persons[i].type = o?.value ?? 'employee')),
              if (persons[i].type == 'employee')
                AppSelect<int>(label: 'Employee', required: true, value: persons[i].userId, loadOptions: (q) async => filterOptions(employees, q),
                    valueLabel: employees.where((e) => e.value == persons[i].userId).firstOrNull?.label, onChanged: (o) => setS(() => persons[i].userId = o?.value))
              else ...[
                AppTextField(label: 'Name', controller: persons[i].name, required: true),
                AppTextField(label: 'Company / contractor', controller: persons[i].company),
              ],
              AppTextField(label: 'Age', controller: persons[i].age, keyboardType: TextInputType.number),
              AppTextField(label: 'Occupation', controller: persons[i].occupation, hint: 'e.g. Welder'),
              AppSelect<String>(label: 'Outcome', value: persons[i].outcome, clearable: false, options: _opts(meta, 'outcomes'), onChanged: (o) => setS(() => persons[i].outcome = o?.value ?? 'first_aid')),
              AppTextField(label: 'Nature of injury', controller: persons[i].injury, hint: 'e.g. Cut, burn, fracture'),
              AppTextField(label: 'Body part', controller: persons[i].body),
              if (persons[i].outcome == 'lost_time') ...[
                AppTextField(label: 'Days lost', controller: persons[i].lostDays, required: true, keyboardType: TextInputType.number),
                DateField(label: 'Back at work on', value: persons[i].back, onChanged: (d) => setS(() => persons[i].back = d)),
              ],
              AppTextField(label: 'Treatment given', controller: persons[i].treatment, hint: 'First aid at site / taken to hospital…'),
            ],
            Align(alignment: Alignment.centerLeft, child: LinkAction('+ Add person', () => setS(() => persons.add(_Person())))),
            const Caps('Witnesses'),
            if (witnesses.isEmpty) const HintText('Add anyone who saw it happen.'),
            for (var i = 0; i < witnesses.length; i++) ...[
              AppTextField(label: 'Name', controller: witnesses[i].$1),
              AppTextField(label: 'What they saw', controller: witnesses[i].$2),
              Align(alignment: Alignment.centerLeft, child: LinkAction('Remove witness', () => setS(() => witnesses.removeAt(i)), color: Brand.danger)),
            ],
            Align(alignment: Alignment.centerLeft, child: LinkAction('+ Add witness', () => setS(() => witnesses.add((TextEditingController(), TextEditingController()))))),
          ],
      onSave: () async {
        final p = <String>[];
        if (title.text.trim().length < 3) p.add('Give the incident a short title (what happened).');
        if (date == null || (time ?? '').isEmpty) p.add('Enter the date and time it happened.');
        if (desc.text.trim().length < 10) p.add('Describe what happened in a few sentences (at least 10 characters).');
        for (var i = 0; i < persons.length; i++) {
          if (persons[i].type == 'employee' && persons[i].userId == null) p.add('Person ${i + 1}: pick the employee.');
          if (persons[i].type != 'employee' && persons[i].name.text.trim().isEmpty) p.add('Person ${i + 1}: type their name.');
        }
        if (p.isNotEmpty) throw p.join(' ');
        final inc = mapOf(await Api.post('/hr/safety/incidents', data: {
          'title': title.text.trim(), 'incident_type': type, 'severity': sev, 'branch_id': branch, 'department_id': dept,
          'location_text': textOrNull(place.text), 'occurred_at': '${apiDate(date!)}T$time:00+05:30',
          'description': desc.text.trim(), 'immediate_action': textOrNull(action.text), 'asset_id': asset, 'erp_project_id': project,
          'witnesses': [for (final w in witnesses) if (w.$1.text.trim().isNotEmpty) {'name': w.$1.text.trim(), 'statement': textOrNull(w.$2.text)}],
          'persons': [for (final x in persons) x.payload()],
        }));
        for (final f in files) {
          try {
            await Api.post('/hr/safety/incidents/${inc['id']}/attachments', data: FormData.fromMap({'file': f}));
          } catch (_) {
            // An upload failure must not block the report (portal behaviour).
          }
        }
        created = inc;
      });
  return ok ? created : null;
}

/// HR › Safety.
class SafetyPage extends StatefulWidget {
  const SafetyPage({super.key});

  @override
  State<SafetyPage> createState() => _SafetyPageState();
}

class _SafetyPageState extends State<SafetyPage> {
  final bool _ehs = Perm.can('hr', 'safety', 'view');
  int _view = 0;
  String _status = 'open';
  String? _type;
  int _rev = 0;
  Json? _stats;
  List<Json> _actions = [];

  @override
  void initState() {
    super.initState();
    Api.list('/hr/safety/actions/mine').then((p) { if (mounted) setState(() => _actions = p.rows); }, onError: (_) {});
    if (_ehs) Api.get('/hr/safety/stats').then((s) { if (mounted) setState(() => _stats = mapOf(s)); }, onError: (_) {});
  }

  Future<void> _report() async {
    final inc = await showReportIncident(context);
    if (inc != null && mounted) {
      await openScreen(context, IncidentDetailScreen(id: asInt(inc['id']) ?? 0));
      setState(() => _rev++);
    }
  }

  Widget _header() {
    final s = _stats;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      PageHeader('Safety',
          subtitle: _ehs
              ? 'Accidents, near misses, dangerous occurrences and first-aid cases: investigation, CAPA, Form 18 to the Inspector (Factories Act s.88 / 88A) and closure approval.'
              : 'Report an accident, near miss or unsafe occurrence. Incidents you reported or are involved in, and safety actions assigned to you, are listed here.',
          actions: [headerButton('Report incident', _report)]),
      if (_actions.isNotEmpty) ...[
        BlockTitle('Safety actions assigned to you · ${_actions.length}'),
        for (final a in _actions)
          RecordCard(
            code: str(a['incident_no']),
            title: str(a['description']),
            trailing: a['is_overdue'] == true ? const HrPill('Overdue', '#DC2626') : null,
            meta: [('Due', fmtDate(a['due_date']))],
            onTap: () async {
              await openScreen(context, IncidentDetailScreen(id: asInt(a['incident_id']) ?? 0));
              setState(() => _rev++);
            },
          ),
      ],
      if (_ehs && s != null)
        TileGrid([
          StatTile(label: 'Incidents', value: numTxt(s['total']), sub: '${numTxt(s['open'])} open'),
          StatTile(label: 'Lost-time injuries', value: numTxt(s['lti']), sub: '${numTxt(s['lost_days'])} days lost'),
          StatTile(label: 'LTIFR', value: s['ltifr'] == null ? '—' : numTxt(s['ltifr']), sub: 'per 10 lakh man-hours'),
          StatTile(label: 'Severity rate', value: s['severity_rate'] == null ? '—' : numTxt(s['severity_rate']), sub: 'days lost per 10 lakh man-hours'),
          StatTile(label: 'Near misses', value: numTxt(mapOf(s['by_type'])['near_miss']), sub: 'reported'),
          StatTile(label: 'Form 18 pending', value: numTxt(s['form18_pending']), sub: 'reportable, not yet sent'),
          StatTile(label: 'Overdue CAPA', value: numTxt(s['overdue_actions']), sub: 'past due date'),
        ]),
      if (_ehs) SubTabs(labels: const ['Incidents', 'Accident register'], index: _view, onChanged: (i) => setState(() => _view = i)),
      if (_ehs && _view == 0)
        ChipRow([
          CountChip('Open (not closed)', null, selected: _status == 'open', onTap: () => setState(() => _status = 'open')),
          CountChip('All statuses', null, selected: _status.isEmpty, onTap: () => setState(() => _status = '')),
          for (final e in _statusLabels.entries) CountChip(e.value, null, selected: _status == e.key, onTap: () => setState(() => _status = e.key)),
        ]),
      if (_ehs && _view == 0)
        padded(AppSelect<String>(label: 'All types', value: _type, options: optionsOf(_typeLabels), onChanged: (o) => setState(() => _type = o?.value))),
      if (_ehs && _view == 1 && Perm.can('hr', 'safety', 'export'))
        padded(Align(alignment: Alignment.centerLeft, child: headerButton('Export CSV', () => openApiFile(context, '/hr/safety/register/export', 'accident_register.csv'), primary: false))),
    ]);
  }

  @override
  Widget build(BuildContext context) {
    if (_ehs && _view == 1) {
      return ApiListView(
        key: ValueKey('reg$_rev'),
        load: (_, _) async => ApiPage(rowsOf(mapOf(await Api.get('/hr/safety/register'))['items'])),
        emptyText: 'No incidents in the register.',
        header: _header(),
        itemBuilder: (ctx, r, reload) => RecordCard(
          code: str(r['incident_no']),
          title: labelOf(_typeLabels, r['incident_type']),
          trailing: statusPill(r['status'], _statusLabels, _statusHex),
          meta: [
            ('Date & time', fmtDateTime(r['occurred_at'])),
            ('Plant / place', joinNonEmpty([r['branch_name'], r['location_text']])),
            if (str(r['persons_injured']).isNotEmpty) ('Persons injured', str(r['persons_injured'])),
            if (str(r['injury']).isNotEmpty) ('Injury', str(r['injury'])),
            ('Days lost', numTxt(r['lost_days'])),
            ('Form 18', r['reportable'] == true ? (str(r['form18_submitted_on']).isEmpty ? 'Due' : 'Sent ${fmtDate(r['form18_submitted_on'])}') : 'Not reportable'),
          ],
          onTap: () => openScreen(context, IncidentDetailScreen(id: asInt(r['id']) ?? 0)),
        ),
      );
    }
    return ApiListView(
      key: ValueKey('inc_${_status}_${_type}_$_rev'),
      searchHint: _ehs ? 'Search no., title, place…' : null,
      load: (_, q) => _ehs
          ? Api.list('/hr/safety/incidents', query: {'status': _status == 'open' ? null : _status, if (_status == 'open') 'open_only': true, 'incident_type': _type, 'search': q})
          : Api.list('/hr/safety/incidents/mine'),
      emptyText: _ehs ? 'No incidents match these filters.' : 'You have not reported or been involved in any incident.',
      header: _header(),
      itemBuilder: (ctx, r, reload) => RecordCard(
        code: str(r['incident_no']),
        title: str(r['title']),
        subtitle: joinNonEmpty([r['branch_name'], r['location_text']]),
        trailing: statusPill(r['status'], _statusLabels, _statusHex),
        meta: [
          ('Type', '${labelOf(_typeLabels, r['incident_type'])}${r['reportable'] == true ? (str(r['form18_submitted_on']).isEmpty ? ' · Form 18 due' : ' · Form 18 sent') : ''}'),
          ('Severity', labelOf(_sevLabels, r['severity'])),
          ('Happened', fmtDateTime(r['occurred_at'])),
          ('Injured / lost days', '${numTxt(r['injured_count'])} / ${numTxt(r['lost_days'])}'),
          ('CAPA', '${numTxt(r['open_actions'])} open${toNum(r['overdue_actions']) > 0 ? ' · ${numTxt(r['overdue_actions'])} overdue' : ''}'),
        ],
        onTap: () async {
          await openScreen(context, IncidentDetailScreen(id: asInt(r['id']) ?? 0));
          reload();
        },
      ),
    );
  }
}

/// One incident: what happened, persons, CAPA (own actions can be completed),
/// attachments. Investigation, statutory Form 18 and closure stay on the portal.
class IncidentDetailScreen extends StatefulWidget {
  const IncidentDetailScreen({super.key, required this.id});
  final int id;

  @override
  State<IncidentDetailScreen> createState() => _IncidentDetailScreenState();
}

class _IncidentDetailScreenState extends State<IncidentDetailScreen> {
  Json? _i;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final i = mapOf(await Api.get('/hr/safety/incidents/${widget.id}'));
      if (mounted) setState(() { _i = i; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _complete(Json a) async {
    final r = await promptDialog(context, title: 'Complete this action?', message: str(a['description']), label: 'What was done', confirmLabel: 'Complete');
    if (r == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/safety/incidents/${widget.id}/actions/${a['id']}/complete', data: {'remarks': r.trim()}), success: 'Action completed.');
    if (ok) _load();
  }

  Future<void> _upload() async {
    final f = await Files.pickFile();
    if (f == null || !mounted) return;
    final ok = await runAction(context, () => Api.post('/hr/safety/incidents/${widget.id}/attachments', data: FormData.fromMap({'file': f})), success: '“${f.filename}” uploaded.');
    if (ok) _load();
  }

  @override
  Widget build(BuildContext context) {
    final i = _i;
    if (i == null) return SubPage(title: 'Incident', body: _error != null ? ErrorView(_error!, onRetry: _load) : const LoadingView());
    final ehsAction = i['can_edit'] == true || i['can_investigate'] == true || i['can_submit_closure'] == true;
    return SubPage(
      title: str(i['incident_no']),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 40), children: [
          DetailSection(str(i['title']), action: statusPill(i['status'], _statusLabels, _statusHex), children: [
            Wrap(spacing: 6, children: [HrPill(labelOf(_typeLabels, i['incident_type']), '#475569'), statusPill(i['severity'], _sevLabels, _sevHex)]),
            FieldRow('Happened', fmtDateTime(i['occurred_at'])),
            FieldRow('Reported', '${fmtDateTime(i['reported_at'])}${str(i['reported_by_name']).isEmpty ? '' : ' by ${i['reported_by_name']}'}'),
            FieldRow('Where', joinNonEmpty([i['branch_name'], i['department_name'], i['location_text']])),
            FieldRow('Description', i['description']),
            if (str(i['immediate_action']).isNotEmpty) FieldRow('Immediate action', i['immediate_action']),
            if (str(i['asset_label']).isNotEmpty) FieldRow('Machine / equipment', i['asset_label']),
            if (str(i['erp_project_label']).isNotEmpty) FieldRow('Customer machine', i['erp_project_label']),
            if (str(i['investigation_lead_name']).isNotEmpty) FieldRow('Investigation lead', i['investigation_lead_name']),
            if (str(i['root_cause']).isNotEmpty) FieldRow('Root cause', i['root_cause']),
            FieldRow('Form 18', i['reportable'] == true ? (str(i['form18_submitted_on']).isEmpty ? 'Reportable — not yet sent' : 'Sent ${fmtDate(i['form18_submitted_on'])}') : 'Not reportable'),
            if (str(i['closure_remarks']).isNotEmpty) FieldRow('Closure', '${i['closure_remarks']}${str(i['closed_by_name']).isEmpty ? '' : ' · ${i['closed_by_name']}'}'),
          ]),
          if (rowsOf(i['persons']).isNotEmpty)
            DetailSection('Persons Injured / Involved', children: [
              for (final p in rowsOf(i['persons']))
                FieldRow(str(p['display_name']).isEmpty ? str(p['external_name']) : str(p['display_name']),
                    joinNonEmpty([humanize(p['outcome']), p['injury_nature'], p['body_part'], toNum(p['lost_days']) > 0 ? '${numTxt(p['lost_days'])} days lost' : null, p['treatment']])),
            ]),
          if (i['witnesses'] is List && (i['witnesses'] as List).isNotEmpty)
            DetailSection('Witnesses', children: [for (final w in rowsOf(i['witnesses'])) FieldRow(str(w['name']), w['statement'])]),
          DetailSection('Corrective & preventive actions', children: [
            if (rowsOf(i['actions']).isEmpty) const HintText('No actions yet.'),
            for (final a in rowsOf(i['actions'])) ...[
              const Divider(height: 12),
              Text(str(a['description']), style: const TextStyle(fontWeight: FontWeight.w600)),
              HintText('${humanize(a['action_type'])} · ${a['owner_name']} · due ${fmtDate(a['due_date'])} · ${humanize(a['status'])}${a['is_overdue'] == true ? ' · overdue' : ''}'
                  '${str(a['completion_remarks']).isEmpty ? '' : '\n“${a['completion_remarks']}”'}'),
              if (a['can_complete'] == true) Align(alignment: Alignment.centerLeft, child: LinkAction('Complete', () => _complete(a))),
            ],
          ]),
          DetailSection('Attachments', action: LinkAction('+ Upload', _upload), children: [
            if (rowsOf(i['attachments']).isEmpty) const HintText('No photos or documents yet.'),
            for (final f in rowsOf(i['attachments']))
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.attach_file_rounded),
                title: Text(str(f['filename'])),
                subtitle: Text(joinNonEmpty([f['uploaded_by_name'], fmtDate(f['created_at'])])),
                onTap: () => openApiFile(context, '/hr/safety/incidents/${widget.id}/attachments/${f['id']}', str(f['filename'])),
              ),
          ]),
          if (i['can_print'] == true)
            padded(Align(alignment: Alignment.centerLeft, child: headerButton('Form 18 (PDF)', () => openApiFile(context, '/hr/safety/incidents/${widget.id}/form18.pdf', '${i['incident_no']}_form18.pdf'), primary: false))),
          if (ehsAction)
            const PortalOnlyCard(
              title: 'Investigation, Form 18 and closure',
              message: 'Editing the incident, the investigation (root cause, persons), adding CAPA, the statutory Form 18 details and closure approval are done on the web portal.',
              path: '/dashboard/hr/safety',
            ),
        ]),
      ),
    );
  }
}

/// Brand colour reference (keeps imports aligned with other HR files).
const safetyAccent = Brand.danger;