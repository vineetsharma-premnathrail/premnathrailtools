import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../ui/files.dart';
import '../../ui/perms.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';

// Spares - frontend/src/app/dashboard/maintenance/spares/page.tsx.

const _stockHex = {'below': kRed, 'reorder': kAmber, 'ok': kGreen, 'none': kGrey};
const _stockLabels = {'below': 'Below min', 'reorder': 'At reorder', 'ok': 'OK', 'none': 'No min set'};

String _stockState(Json s) {
  if (s['below_min'] == true) return 'below';
  if (s['at_reorder'] == true) return 'reorder';
  if (s['minimum_stock'] == null && s['reorder_level'] == null) return 'none';
  return 'ok';
}

int _prQty(Json s) {
  final q = asNum(s['suggested_order_qty']) ?? 1;
  return q < 1 ? 1 : q.ceil();
}

class SparesList extends StatefulWidget {
  const SparesList({super.key});

  @override
  State<SparesList> createState() => _SparesListState();
}

class _SparesListState extends State<SparesList> {
  final _list = GlobalKey<ApiListViewState>();
  int? _branch;
  bool _belowOnly = false;
  bool _criticalOnly = false;
  Json? _lookups;
  int _below = 0;
  int _criticalBelow = 0;
  bool _loaded = false;

  bool get _canRaisePr => Perm.hasApp('p2p');

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

  Future<ApiPage> _load(int page, String search) async {
    final p = await Api.list('/maintenance/spares', query: {
      'branch_id': _branch,
      'search': search,
      'below_min_only': _belowOnly ? true : null,
      'critical_only': _criticalOnly ? true : null,
    });
    if (mounted) {
      setState(() {
        _loaded = true;
        _below = p.rows.where((s) => s['below_min'] == true).length;
        _criticalBelow = p.rows.where((s) => s['below_min'] == true && s['is_critical'] == true).length;
      });
    }
    return p;
  }

  /// The PR form lives in Procurement; it opens pre-filled with this item.
  void _raisePr(Json s) {
    final q = Uri(queryParameters: {
      'store_item_id': '${s['store_item_id']}',
      'make': str(s['make']),
      'quantity': '${_prQty(s)}',
      'remarks': 'Maintenance spares — ${s['item_code']} ${s['item_name']} below minimum '
          '(on hand ${fmtQty(s['on_hand_total'])}, min ${fmtQty(s['minimum_stock'] ?? s['reorder_level'])}).',
    }).query;
    runAction(context, () => Files.openInPortal('/dashboard/p2p/new?$q'));
  }

  void _details(Json s) {
    final branchNames = {for (final b in MtLookups.branches(_lookups)) b.value: b.label};
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.8),
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.all(16),
            children: [
              Text('${s['item_code']} ${s['item_name']}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700)),
              const SizedBox(height: 12),
              Caps('Stock by location${_branch != null ? ' (${branchNames[_branch] ?? 'plant'})' : ''}'),
              if (asList(s['locations']).isEmpty) mutedText('No stock in any store${_branch != null ? ' of this plant' : ''}.'),
              for (final l in asList(s['locations']))
                LineItem(
                  title: '${l['location_name']}${_branch == null && branchNames[asInt(l['branch_id'])] != null ? ' · ${branchNames[asInt(l['branch_id'])]}' : ''}',
                  trailing: [
                    Text('${fmtQty(l['on_hand'])} ${str(s['uom'])}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    if ((asNum(l['reserved']) ?? 0) > 0) smallText('${fmtQty(l['reserved'])} reserved'),
                  ],
                ),
              const SizedBox(height: 12),
              const Caps('Used on'),
              if (asList(s['assets']).isEmpty) mutedText("Not on any asset's bill of spares yet."),
              for (final a in asList(s['assets']))
                LineItem(
                  title: '${a['asset_code']} ${a['asset_name']}',
                  subtitle: '${fmtQty(a['qty_per_replacement'])} ${str(s['uom'])} per replacement${a['is_critical'] == true ? ' · critical' : ''}',
                  onTap: () {
                    Navigator.pop(ctx);
                    openScreen(context, AssetDetailScreen(id: asInt(a['asset_id'])!));
                  },
                ),
              if ((asNum(s['reorder_quantity']) ?? 0) > 0)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: smallText('Store reorder quantity: ${fmtQty(s['reorder_quantity'])} ${str(s['uom'])}'),
                ),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final branches = MtLookups.branches(_lookups);
    final header = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const MtHeader('Spares',
            subtitle: "Spare parts are Store items — stock, minimum and reorder level come from the Store. Add spares to an asset from its Spares tab."),
        if (_loaded && _below > 0)
          NoteBanner('$_below spare${_below == 1 ? ' is' : 's are'} below minimum stock${_criticalBelow > 0 ? ', $_criticalBelow of them critical' : ''}.'
              '${_canRaisePr ? ' Raise a PR to reorder.' : ' Ask someone with P2P access to raise a purchase request.'}'),
        filterRow([
          if (branches.length > 1)
            FilterSelect<int>(allLabel: 'All plants', value: _branch, options: branches, onChanged: (v) => _refilter(() => _branch = v)),
          FilterToggle(label: 'Below minimum only', value: _belowOnly, onChanged: (v) => _refilter(() => _belowOnly = v)),
          FilterToggle(label: 'Critical only', value: _criticalOnly, onChanged: (v) => _refilter(() => _criticalOnly = v)),
        ]),
      ],
    );
    return ApiListView(
      key: _list,
      header: header,
      searchHint: 'Search by item code, name or part number…',
      load: _load,
      emptyText: _branch != null || _belowOnly || _criticalOnly
          ? 'No spares match these filters.'
          : "No spares yet. Create spare parts in Store › Items (type Spare Part) or add Store items to an asset's bill of spares.",
      itemBuilder: (ctx, s, reload) {
        final state = _stockState(s);
        final assets = asList(s['assets']);
        final type = str(s['item_type']);
        return RecordCard(
          code: str(s['item_code']),
          title: str(s['item_name']),
          subtitle: [
            if (str(s['part_number']).isNotEmpty) str(s['part_number']),
            if (type.isNotEmpty && type != 'spare_part') type,
          ].join(' · '),
          trailing: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
            Pill(_stockLabels[state]!, _stockHex[state]!),
            if (s['is_critical'] == true) const Padding(padding: EdgeInsets.only(top: 4), child: Pill('Critical', kRed)),
          ]),
          meta: [
            ('Used On', assets.isEmpty ? '—' : '${assets.length} asset${assets.length == 1 ? '' : 's'}'),
            ('On Hand', '${fmtQty(s['on_hand_total'])} ${str(s['uom'])}'.trim()),
            ('Min / Reorder', '${fmtQty(s['minimum_stock'])} / ${fmtQty(s['reorder_level'])}'),
            ('Used (90d)', (asNum(s['consumed_90d']) ?? 0) == 0 ? '—' : fmtQty(s['consumed_90d'])),
          ],
          onTap: () => _details(s),
        ).withPr(s['below_min'] == true && _canRaisePr ? () => _raisePr(s) : null, 'Raise PR (${_prQty(s)})');
      },
    );
  }
}

extension on RecordCard {
  /// Card with a "Raise PR" button under it (below-minimum spares).
  Widget withPr(VoidCallback? onTap, String text) {
    if (onTap == null) return this;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      this,
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: Align(alignment: Alignment.centerRight, child: smallBtn(text, onTap)),
      ),
    ]);
  }
}
