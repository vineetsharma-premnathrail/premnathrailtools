import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/files.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';

// AMC & Warranty - frontend/src/app/dashboard/maintenance/contracts/page.tsx.

const _statusLabels = {'expired': 'Expired', 'expiring': 'Expiring', 'active': 'Active', 'none': 'Not covered'};
const _statusHex = {'expired': kRed, 'expiring': kAmber, 'active': kGreen, 'none': kGrey};
const _kindLabels = {'warranty': 'Warranty', 'amc': 'AMC'};
const _kindHex = {'warranty': kBlue, 'amc': Color(0xFF7C3AED)};

String _daysLeft(Object? v) {
  final d = asInt(v);
  if (d == null) return 'No date';
  if (d < 0) return '${-d} day${d == -1 ? '' : 's'} ago';
  if (d == 0) return 'Today';
  return '$d day${d == 1 ? '' : 's'}';
}

class ContractsList extends StatefulWidget {
  const ContractsList({super.key});

  @override
  State<ContractsList> createState() => _ContractsListState();
}

class _ContractsListState extends State<ContractsList> {
  final _list = GlobalKey<ApiListViewState>();
  int? _branch;
  String _kind = 'all';
  int _window = 60;
  String? _status;
  String _search = '';
  Json? _lookups;
  Json? _summary;
  String? _asOf;

  @override
  void initState() {
    super.initState();
    MtLookups.tryGet().then((lk) {
      if (mounted) setState(() => _lookups = lk);
    });
  }

  void _refilter(VoidCallback change) {
    setState(change);
    WidgetsBinding.instance.addPostFrameCallback((_) => _list.currentState?.reload());
  }

  Map<String, dynamic> get _params => {
        'kind': _kind,
        'window_days': _window,
        'branch_id': _branch,
        'status': _status,
        'search': _search,
      };

  Future<ApiPage> _load(int page, String search) async {
    _search = search;
    final d = asMap(await Api.get('/maintenance/contracts', query: _params));
    if (mounted) {
      setState(() {
        _summary = asMap(d?['summary']);
        _asOf = str(d?['as_of']);
      });
    }
    return ApiPage.from(d);
  }

  Future<void> _export() => runAction(
      context,
      () => Files.downloadAndOpen('/maintenance/contracts/export',
          'maintenance_amc_warranty_${(_asOf ?? apiDate(DateTime.now())).substring(0, 10)}.xlsx',
          query: {..._params}..removeWhere((k, v) => v == null || v == '')));

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final tiles = [
      ('expired', 'Expired', 'Cover has lapsed — repairs are now chargeable.'),
      ('expiring', 'Expiring ≤ $_window days', 'Renew or claim before the date.'),
      ('active', 'Active', 'Covered beyond the next $_window days.'),
      ('none', 'Not covered', 'No expiry date recorded on the asset.'),
    ];
    final canExport = Mt.can('assets', 'export') && Mt.feat('assets', 'contracts', 'export');
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        MtHeader(
          'AMC & Warranty',
          subtitle: "Warranty is the maker's / supplier's promise to repair defects free for a fixed period after purchase — it comes with the machine. "
              'AMC (Annual Maintenance Contract) is a service contract you pay a vendor for, covering periodic servicing and breakdown support. '
              'Once either lapses, every repair is billed. Dates and vendors are edited on the asset; planners get a reminder 30, 15, 7 and 1 day before expiry and the day after.',
          actions: [if (canExport) smallBtn('Export Excel', _export)],
        ),
        kpiGrid([
          for (final (key, lbl, caption) in tiles)
            Container(
              decoration: _status == key
                  ? BoxDecoration(border: Border.all(color: _statusHex[key]!, width: 2), borderRadius: BorderRadius.circular(18))
                  : null,
              child: KpiTile(
                label: lbl,
                value: _summary == null ? '—' : '${_summary![key] ?? 0}',
                sub: caption,
                color: _statusHex[key],
                onTap: () => _refilter(() => _status = _status == key ? null : key),
              ),
            ),
        ]),
        filterRow([
          if (branches.length > 1)
            FilterSelect<int>(allLabel: 'All plants', value: _branch, options: branches, onChanged: (v) => _refilter(() => _branch = v)),
          FilterSelect<String>(
            allLabel: 'Warranty + AMC',
            allowAll: false,
            value: _kind,
            options: const [Option('all', 'Warranty + AMC'), Option('warranty', 'Warranty only'), Option('amc', 'AMC only')],
            onChanged: (v) => _refilter(() => _kind = v ?? 'all'),
          ),
          FilterSelect<String>(
              allLabel: 'Any status', value: _status, options: optionsOf(_statusLabels), onChanged: (v) => _refilter(() => _status = v)),
          FilterSelect<int>(
            allLabel: 'Expiring within',
            allowAll: false,
            value: _window,
            options: [for (final d in const [30, 60, 90, 180]) Option(d, 'Expiring within $d days')],
            onChanged: (v) => _refilter(() => _window = v ?? 60),
          ),
        ]),
        if (_asOf != null && _asOf!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 8),
            child: smallText('As of ${fmtDate(_asOf)} · decommissioned assets are not listed · warranty vendor = the supplier the asset was bought from.'),
          ),
      ],
    );
    return ApiListView(
      key: _list,
      header: header,
      searchHint: 'Search by asset code or name…',
      load: _load,
      emptyText: _branch != null || _status != null || _kind != 'all'
          ? 'No assets match these filters.'
          : 'No assets in the register yet. Add assets under Maintenance › Assets and record their warranty / AMC expiry there.',
      itemBuilder: (ctx, r, reload) => RecordCard(
        code: str(r['asset_code']),
        title: str(r['asset_name']),
        trailing: Pill(_statusLabels[r['status']] ?? str(r['status']), _statusHex[r['status']] ?? kGrey),
        meta: [
          ('Plant', txt(r['branch_name'])),
          ('Crit.', str(r['criticality'])),
          ('Cover', _kindLabels[r['kind']] ?? str(r['kind'])),
          ('Vendor', txt(r['vendor_name'])),
          ('Expiry Date', fmtDate(r['expiry_date'])),
          ('Days Left', _daysLeft(r['days_left'])),
        ],
        onTap: () => openScreen(ctx, AssetDetailScreen(id: asInt(r['asset_id'])!)),
      ),
    );
  }
}

/// Kind colours are used by the cover pill in the asset list meta.
Color kindColor(Object? kind) => _kindHex[kind] ?? kGrey;
