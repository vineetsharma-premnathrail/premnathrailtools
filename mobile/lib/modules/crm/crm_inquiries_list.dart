import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';
import 'crm_inquiry_detail.dart';
import 'crm_inquiry_forms.dart';
import 'crm_record_tabs.dart';

/// Count chips above the list; each is also a filter (inquiries/page.tsx).
enum InqStat {
  leads('Leads', CrmKind.inquiry, Color(0xFF475569)),
  inquiries('Inquiries', CrmKind.inquiry, Color(0xFF3B82F6)),
  published('Tenders published', CrmKind.tender, Color(0xFF7C3AED)),
  participation('Tender participation', CrmKind.tender, Color(0xFF0891B2)),
  pending('Pending tenders', CrmKind.tender, Color(0xFFEAB308));

  const InqStat(this.label, this.kind, this.color);
  final String label;
  final CrmKind kind;
  final Color color;
}

class _Row {
  _Row(this.kind, this.rec, this.orgName);
  final CrmKind kind;
  final Json rec;
  final String orgName;

  String get status => str(rec['status']);
  String get createdBy => str(rec['created_by_name']);
  String get id => str(rec['universal_id']);
  String get product => kind == CrmKind.inquiry
      ? (str(rec['product']).isEmpty ? 'Not provided' : str(rec['product']))
      : (str(rec['tender_category']).isNotEmpty ? str(rec['tender_category']) : str(rec['tender_name']));

  bool matches(InqStat s) {
    final closed = status.startsWith('Closed');
    final qualified = CrmLists.inquiryStatuses.indexOf('Qualified Inquiry');
    final i = CrmLists.inquiryStatuses.indexOf(status);
    switch (s) {
      case InqStat.leads:
        return kind == CrmKind.inquiry && !closed && i >= 0 && i < qualified;
      case InqStat.inquiries:
        return kind == CrmKind.inquiry && !closed && i >= qualified;
      case InqStat.published:
        return kind == CrmKind.tender && status != 'Tender Cancelled';
      case InqStat.participation:
        return kind == CrmKind.tender &&
            status != 'Tender Cancelled' &&
            CrmLists.tenderStatuses.indexOf(status) >= CrmLists.tenderStatuses.indexOf('Tender Participation');
      case InqStat.pending:
        return kind == CrmKind.tender && !closed && status != 'Tender Cancelled';
    }
  }
}

/// CRM › Inquiries & Tenders list.
class InquiriesTab extends StatefulWidget {
  const InquiriesTab({super.key, this.initialType = 'inquiry', this.initialStat});
  final String initialType;
  final InqStat? initialStat;

  @override
  State<InquiriesTab> createState() => _InquiriesTabState();
}

class _InquiriesTabState extends State<InquiriesTab> {
  final _list = GlobalKey<ApiListViewState>();
  List<_Row> _all = const [];
  String? _loadedFor;
  late String _type = widget.initialType; // inquiry / tender / all
  late InqStat? _stat = widget.initialStat;
  String _status = '';
  String _org = '';
  String _createdBy = '';
  String _sort = 'id_asc';

  Future<ApiPage> _load(int page, String search) async {
    if (_loadedFor != search) {
      final res = await Future.wait([
        Api.list('/crm/inquiries', query: {'search': search, 'limit': 10000}),
        Api.list('/crm/tenders', query: {'search': search, 'limit': 10000}),
        Api.list('/crm/organizations', query: {'picker': true}),
      ]);
      final orgs = {for (final o in res[2].rows) asInt(o['id']): str(o['name'])};
      final rows = [
        for (final i in res[0].rows) _Row(CrmKind.inquiry, i, orgs[asInt(i['org_id'])] ?? 'Not provided'),
        for (final t in res[1].rows) _Row(CrmKind.tender, t, orgs[asInt(t['org_id'])] ?? 'Not provided'),
      ];
      if (mounted) {
        setState(() {
          _all = rows;
          _loadedFor = search;
        });
      }
    }
    return ApiPage(_visible().map((r) => {'__row': r}).toList());
  }

  bool _colOk(_Row r) =>
      (_status.isEmpty || r.status == _status) && (_org.isEmpty || r.orgName == _org) && (_createdBy.isEmpty || r.createdBy == _createdBy);

  List<_Row> _visible() {
    final rows = _all
        .where((r) => (_type == 'all' || r.kind.key == _type) && (_stat == null || r.matches(_stat!)) && _colOk(r))
        .toList();
    rows.sort((a, b) => switch (_sort) {
          'id_desc' => b.id.toLowerCase().compareTo(a.id.toLowerCase()),
          'created_desc' => str(b.rec['created_at']).compareTo(str(a.rec['created_at'])),
          'created_asc' => str(a.rec['created_at']).compareTo(str(b.rec['created_at'])),
          _ => a.id.toLowerCase().compareTo(b.id.toLowerCase()),
        });
    return rows;
  }

  void _refilter() {
    setState(() {});
    _list.currentState?.reload();
  }

  void _reloadAll() {
    _loadedFor = null;
    _list.currentState?.reload();
  }

  List<String> _values(String Function(_Row) f) {
    final s = _all.where((r) => _type == 'all' || r.kind.key == _type).map(f).where((v) => v.isNotEmpty && v != 'Not provided').toSet().toList()
      ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
    return s;
  }

  Future<void> _filters() async {
    var type = _type;
    var status = _status;
    var org = _org;
    var by = _createdBy;
    var sort = _sort;
    final ok = await showFormSheet(
      context,
      title: 'Filter',
      saveLabel: 'Apply',
      builder: (ctx, setS) => [
        AppSelect<String>(
          label: 'Type',
          value: type,
          clearable: false,
          options: const [Option('inquiry', 'Inquiries'), Option('tender', 'Tenders'), Option('all', 'Inquiries and tenders')],
          onChanged: (o) => setS(() => type = o?.value ?? type),
        ),
        AppSelect<String>(
            label: 'Status', value: status.isEmpty ? null : status, options: opts(_values((r) => r.status)), onChanged: (o) => setS(() => status = o?.value ?? '')),
        AppSelect<String>(
            label: 'Customer Organization',
            value: org.isEmpty ? null : org,
            options: opts(_values((r) => r.orgName)),
            onChanged: (o) => setS(() => org = o?.value ?? '')),
        AppSelect<String>(
            label: 'Created By', value: by.isEmpty ? null : by, options: opts(_values((r) => r.createdBy)), onChanged: (o) => setS(() => by = o?.value ?? '')),
        AppSelect<String>(
          label: 'Sort',
          value: sort,
          clearable: false,
          options: const [
            Option('id_asc', 'ID (A–Z)'),
            Option('id_desc', 'ID (Z–A)'),
            Option('created_desc', 'Created Date (Latest)'),
            Option('created_asc', 'Created Date (Old)'),
          ],
          onChanged: (o) => setS(() => sort = o?.value ?? sort),
        ),
      ],
      onSave: () async {},
    );
    if (!ok) return;
    _type = type;
    _status = status;
    _org = org;
    _createdBy = by;
    _sort = sort;
    if (_stat != null && type != 'all' && _stat!.kind.key != type) _stat = null;
    _refilter();
  }

  void _toggleStat(InqStat s) {
    if (_stat == s) {
      _stat = null;
    } else {
      _stat = s;
      _type = s.kind.key;
    }
    _refilter();
  }

  Future<void> _create() async {
    final r = await newInquiryOrTender(context);
    if (r == null || !mounted) return;
    _reloadAll();
    final id = asInt(r.$2['id']);
    if (id != null) openCrmRecord(context, r.$1, id, onChanged: _reloadAll);
  }

  @override
  Widget build(BuildContext context) {
    final base = _all.where(_colOk).toList();
    final filtersOn = _status.isNotEmpty || _org.isNotEmpty || _createdBy.isNotEmpty;
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: 44,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          for (final s in InqStat.values)
            CountChip(s.label, base.where((r) => r.matches(s)).length,
                selected: _stat == s, color: s.color, onTap: () => _toggleStat(s)),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: Row(children: [
          Expanded(
            child: Text(
              '${_type == 'all' ? 'Inquiries and tenders' : _type == 'tender' ? 'Tenders' : 'Inquiries'}'
              '${filtersOn ? ' · filtered' : ''} · ${_visible().length} records',
              style: const TextStyle(color: Brand.muted, fontSize: 13),
            ),
          ),
          if (filtersOn || _stat != null || _type != 'inquiry')
            TextButton(
                onPressed: () {
                  _type = 'inquiry';
                  _stat = null;
                  _status = _org = _createdBy = '';
                  _refilter();
                },
                child: const Text('Clear')),
          OutlinedButton.icon(onPressed: _filters, icon: const Icon(Icons.filter_list_rounded, size: 18), label: const Text('Filter')),
        ]),
      ),
    ]);
    return Scaffold(
      backgroundColor: Brand.background,
      floatingActionButton: CrmPerm.can('inquiries_tenders', 'create') ? CreateFab(label: 'New inquiry or tender', onPressed: _create) : null,
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader('Inquiries & Tenders'),
        Expanded(
          child: ApiListView(
            key: _list,
            searchHint: 'Search ID, customer organization, product, owner, zone...',
            header: header,
            emptyText: 'No records found.',
            load: _load,
            itemBuilder: (ctx, json, reload) {
              final r = json['__row'] as _Row;
              final inq = r.kind == CrmKind.inquiry;
              return RecordCard(
                code: r.id,
                title: r.orgName,
                subtitle: inq ? r.product : joinNonEmpty([r.rec['tender_name'], r.rec['tender_number']], ' · '),
                trailing: Padding(
                  padding: const EdgeInsets.only(left: 8),
                  child: pill(r.status, inq ? CrmLists.inquiryColor(r.status) : CrmLists.tenderColor(r.status)),
                ),
                meta: [
                  if (_type == 'all') ('Type', r.kind.label),
                  ('Created Date', fmtDate(r.rec['created_at'])),
                  ('Created By', r.createdBy.isEmpty ? 'Not provided' : r.createdBy),
                  if (!inq && r.rec['submission_date'] != null) ('Submission', fmtDate(r.rec['submission_date'])),
                ],
                onTap: () => openCrmRecord(context, r.kind, asInt(r.rec['id'])!, onChanged: _reloadAll),
              );
            },
          ),
        ),
      ]),
    );
  }
}
