import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'hr_common.dart';

// Portal: app/dashboard/hr/holidays/page.tsx

const _typeLabels = {'national': 'National', 'festival': 'Festival', 'restricted': 'Restricted', 'optional': 'Optional'};
const _typeHex = {'national': '#DC2626', 'festival': '#F59E0B', 'restricted': '#7C3AED', 'optional': '#0EA5E9'};

class HolidaysPage extends StatefulWidget {
  const HolidaysPage({super.key});

  @override
  State<HolidaysPage> createState() => _HolidaysPageState();
}

class _HolidaysPageState extends State<HolidaysPage> {
  late final bool _isHr = hrStaffFor('holidays');
  int _year = DateTime.now().year;
  late String _branch = _isHr ? '' : 'mine';
  String? _type;
  bool _inactive = false;
  int _rev = 0;
  List<Option<int>> _branches = [];
  String? _notice;

  @override
  void initState() {
    super.initState();
    Api.list('/hr/holidays/branches').then((p) {
      if (mounted) setState(() => _branches = [for (final b in p.rows) Option(asInt(b['id']) ?? 0, str(b['name']))]);
    }, onError: (_) {});
  }

  void _refresh(String msg) => setState(() { _notice = msg; _rev++; });

  Future<void> _form([Json? h]) async {
    DateTime? date = dateOf(h?['holiday_date']);
    final name = TextEditingController(text: str(h?['name']));
    var type = str(h?['holiday_type']).isEmpty ? 'national' : str(h?['holiday_type']);
    int? branch = asInt(h?['branch_id']);
    final desc = TextEditingController(text: str(h?['description']));
    final ok = await showFormSheet(context,
        title: h != null ? 'Edit holiday' : 'Add holiday',
        saveLabel: 'Save',
        builder: (ctx, setS) => [
              const HintText('National and festival holidays are days off; restricted and optional ones are taken as leave.'),
              DateField(label: 'Date', required: true, value: date, onChanged: (d) => setS(() => date = d)),
              AppTextField(label: 'Name', controller: name, required: true, hint: 'e.g. Diwali'),
              AppSelect<String>(label: 'Type', value: type, clearable: false, options: optionsOf(_typeLabels), onChanged: (o) => setS(() => type = o?.value ?? type)),
              AppSelect<int>(label: 'Plant (blank = all plants)', value: branch, options: _branches, onChanged: (o) => setS(() => branch = o?.value)),
              AppTextField(label: 'Description', controller: desc, maxLines: 2),
            ],
        onSave: () async {
          final p = <String>[];
          if (date == null) p.add('Pick the holiday date.');
          if (name.text.trim().isEmpty) p.add('Enter the holiday name (e.g. "Diwali").');
          if (p.isNotEmpty) throw p.join(' ');
          final payload = {'holiday_date': apiDate(date!), 'name': name.text.trim(), 'holiday_type': type, 'branch_id': branch, 'description': textOrNull(desc.text)};
          if (h != null) {
            await Api.patch('/hr/holidays/${h['id']}', data: payload);
          } else {
            await Api.post('/hr/holidays', data: payload);
          }
        });
    if (ok && mounted) {
      if (date!.year != _year) _year = date!.year;
      _refresh('${name.text.trim()} saved.');
    }
  }

  Future<void> _bulk() async {
    final rows = List.generate(5, (_) => (date: <DateTime?>[null], name: TextEditingController(), type: ['national'], branch: <int?>[null]));
    String? msg;
    final ok = await showFormSheet(context,
        title: 'Bulk add holidays',
        saveLabel: 'Add holidays',
        builder: (ctx, setS) => [
              const HintText('Fill as many rows as you need; empty rows are ignored and duplicates are skipped.'),
              for (var i = 0; i < rows.length; i++) ...[
                Caps('Row ${i + 1}'),
                DateField(label: 'Date', value: rows[i].date[0], onChanged: (d) => setS(() => rows[i].date[0] = d)),
                AppTextField(label: 'Name', controller: rows[i].name),
                AppSelect<String>(label: 'Type', value: rows[i].type[0], clearable: false, options: optionsOf(_typeLabels), onChanged: (o) => setS(() => rows[i].type[0] = o?.value ?? 'national')),
                AppSelect<int>(label: 'Plant (blank = all plants)', value: rows[i].branch[0], options: _branches, onChanged: (o) => setS(() => rows[i].branch[0] = o?.value)),
              ],
              Align(
                alignment: Alignment.centerLeft,
                child: LinkAction('+ Add row', () => setS(() => rows.add((date: <DateTime?>[null], name: TextEditingController(), type: ['national'], branch: <int?>[null])))),
              ),
            ],
        onSave: () async {
          final filled = rows.where((r) => r.date[0] != null || r.name.text.trim().isNotEmpty).toList();
          final p = <String>[];
          for (var i = 0; i < filled.length; i++) {
            if (filled[i].date[0] == null) p.add('Row ${i + 1}: pick a date.');
            if (filled[i].name.text.trim().isEmpty) p.add('Row ${i + 1}: enter a name.');
          }
          if (filled.isEmpty) p.add('Fill at least one row.');
          if (p.isNotEmpty) throw p.join(' ');
          final res = mapOf(await Api.post('/hr/holidays/bulk', data: [
            for (final r in filled)
              {'holiday_date': apiDate(r.date[0]!), 'name': r.name.text.trim(), 'holiday_type': r.type[0], 'branch_id': r.branch[0], 'description': null},
          ]));
          final skipped = rowsOf(res['skipped']);
          msg = '${res['created'] is List ? (res['created'] as List).length : res['created']} holiday(s) added.'
              '${skipped.isEmpty ? '' : ' Skipped: ${skipped.map((s) => 'row ${s['row']} ${s['name']} — ${s['reason']}').join('; ')}'}';
        });
    if (ok && msg != null && mounted) _refresh(msg!);
  }

  Future<void> _copy() async {
    var from = _year;
    var to = _year + 1;
    String? msg;
    final ok = await showFormSheet(context,
        title: "Copy a year's holidays",
        saveLabel: 'Copy',
        builder: (ctx, setS) => [
              const HintText('Every active holiday is copied to the same day and month. Holidays that already exist are skipped.'),
              AppSelect<int>(label: 'From year', value: from, clearable: false, options: yearOptions(), onChanged: (o) => setS(() => from = o?.value ?? from)),
              AppSelect<int>(label: 'To year', value: to, clearable: false, options: yearOptions(ahead: 2, back: 1), onChanged: (o) => setS(() => to = o?.value ?? to)),
            ],
        onSave: () async {
          final res = mapOf(await Api.post('/hr/holidays/copy', data: {'from_year': from, 'to_year': to}));
          final review = res['needs_review'] is List ? (res['needs_review'] as List) : const [];
          msg = '${res['created']} holiday(s) copied to $to${toNum(res['skipped']) > 0 ? ', ${res['skipped']} already existed' : ''}.'
              '${review.isEmpty ? '' : ' Check these dates — festivals move every year: ${review.join(', ')}.'}';
        });
    if (ok && msg != null && mounted) {
      _year = to;
      _refresh(msg!);
    }
  }

  void _menu(Json h) {
    final acts = <Widget>[
      if (Perm.can('hr', 'holidays', 'edit')) LinkAction('Edit', () { Navigator.pop(context); _form(h); }),
      if (Perm.can('hr', 'holidays', 'edit'))
        LinkAction(h['is_active'] == true ? 'Deactivate' : 'Activate', () async {
          Navigator.pop(context);
          final yes = await confirmDialog(context,
              title: h['is_active'] == true ? 'Deactivate this holiday?' : 'Reactivate this holiday?',
              message: '${h['name']} on ${fmtDate(h['holiday_date'])}.',
              confirmLabel: h['is_active'] == true ? 'Deactivate' : 'Reactivate');
          if (!yes || !mounted) return;
          final ok = await runAction(context, () => Api.patch('/hr/holidays/${h['id']}', data: {'is_active': h['is_active'] != true}));
          if (ok) setState(() => _rev++);
        }),
      if (Perm.can('hr', 'holidays', 'delete'))
        LinkAction('Delete', () async {
          Navigator.pop(context);
          final yes = await confirmDialog(context, title: 'Delete this holiday?', message: '${h['name']} on ${fmtDate(h['holiday_date'])}.', confirmLabel: 'Delete', danger: true);
          if (!yes || !mounted) return;
          final ok = await runAction(context, () => Api.delete('/hr/holidays/${h['id']}'));
          if (ok) _refresh('${h['name']} deleted.');
        }, color: Brand.danger),
    ];
    if (acts.isEmpty) return;
    showModalBottomSheet<void>(context: context, builder: (_) => SafeArea(child: Padding(padding: const EdgeInsets.all(16), child: actionRow(acts))));
  }

  @override
  Widget build(BuildContext context) {
    final branchOpts = <Option<String>>[
      const Option('mine', 'My plant'),
      if (_isHr) const Option('', 'Every plant (all entries)'),
      const Option('all_only', 'All-plant holidays only'),
      for (final b in _branches) Option('${b.value}', '${b.label} (incl. all-plant)'),
    ];
    return ApiLoader<List<Json>>(
      key: ValueKey('hol_${_year}_${_branch}_${_type}_${_inactive}_$_rev'),
      load: () async => (await Api.list('/hr/holidays', query: {
        'year': _year, 'holiday_type': _type,
        if (_branch == 'mine') 'mine': true else if (_branch == 'all_only') 'only_all_plants': true else if (_branch.isNotEmpty) 'branch_id': int.tryParse(_branch),
        if (_inactive) 'include_inactive': true,
      })).rows,
      builder: (ctx, rows, reload) {
        final today = todayIso();
        final next = rows.where((h) => h['is_active'] == true && str(h['holiday_date']).compareTo(today) >= 0).firstOrNull;
        final months = <int, List<Json>>{};
        for (final h in rows) {
          months.putIfAbsent(int.tryParse(str(h['holiday_date']).substring(5, 7)) ?? 1, () => []).add(h);
        }
        return ListView(padding: const EdgeInsets.only(bottom: 88), children: [
          PageHeader('Holiday Calendar',
              subtitle: 'National and festival holidays are days off for the plant. Restricted and optional holidays are taken as leave.',
              actions: [if (_isHr && Perm.can('hr', 'holidays', 'create')) headerButton('Add Holiday', () => _form())]),
          if (_isHr && Perm.can('hr', 'holidays', 'create'))
            padded(Wrap(spacing: 8, children: [headerButton('Copy year', _copy, primary: false), headerButton('Bulk add', _bulk, primary: false)])),
          if (_notice != null) padded(NoticeBanner(_notice!)),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: Column(children: [
              Row(children: [
                Expanded(child: AppSelect<int>(label: 'Year', value: _year, clearable: false, options: yearOptions(), onChanged: (o) => setState(() => _year = o?.value ?? _year))),
                const SizedBox(width: 8),
                Expanded(child: AppSelect<String>(label: 'All types', value: _type, options: optionsOf(_typeLabels), onChanged: (o) => setState(() => _type = o?.value))),
              ]),
              const SizedBox(height: 8),
              AppSelect<String>(label: 'Plant', value: _branch, clearable: false, options: branchOpts, onChanged: (o) => setState(() => _branch = o?.value ?? 'mine')),
              if (_isHr) CheckField(label: 'Show inactive', value: _inactive, onChanged: (v) => setState(() => _inactive = v)),
            ]),
          ),
          if (next != null) padded(Text('Next: ${next['name']} · ${fmtDate(next['holiday_date'])} (${next['weekday']})', style: const TextStyle(color: Brand.body))),
          if (rows.isEmpty)
            EmptyView('No holidays for $_year${_isHr ? ' yet. Add them one by one, use Bulk add, or copy last year’s calendar.' : '. HR hasn’t published this year’s calendar yet.'}'),
          for (final m in (months.keys.toList()..sort())) ...[
            padded(Caps(monthNames[m - 1])),
            for (final h in months[m]!)
              Opacity(
                opacity: h['is_active'] != true ? 0.45 : (str(h['holiday_date']).compareTo(today) < 0 ? 0.7 : 1),
                child: RecordCard(
                  title: '${h['name']}${h['is_active'] != true ? ' (inactive)' : ''}',
                  subtitle: str(h['description']),
                  trailing: HrPill(labelOf(_typeLabels, h['holiday_type']), _typeHex[str(h['holiday_type'])] ?? '#64748B'),
                  meta: [('Date', fmtDate(h['holiday_date'])), ('Day', str(h['weekday'])), ('Plant', str(h['branch_name']).isEmpty ? 'All plants' : str(h['branch_name']))],
                  onTap: _isHr ? () => _menu(h) : null,
                ),
              ),
          ],
        ]);
      },
    );
  }
}