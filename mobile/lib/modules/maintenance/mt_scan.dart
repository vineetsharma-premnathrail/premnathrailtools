import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/widgets.dart';
import 'mt_assets.dart';
import 'mt_common.dart';
import 'mt_requests.dart';

// Asset tag lookup - frontend/src/app/dashboard/maintenance/scan/[code].
// The printed QR label carries the asset code; on the phone the code is typed
// (or pasted from any QR reader) and the same resolver endpoint is used.

class AssetScanScreen extends StatefulWidget {
  const AssetScanScreen({super.key, this.code});
  final String? code;

  @override
  State<AssetScanScreen> createState() => _AssetScanScreenState();
}

class _AssetScanScreenState extends State<AssetScanScreen> {
  late final _ctrl = TextEditingController(text: widget.code ?? '');
  Json? _asset;
  String? _error;
  bool _loading = false;

  @override
  void initState() {
    super.initState();
    if ((widget.code ?? '').isNotEmpty) _find();
  }

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  Future<void> _find() async {
    var code = _ctrl.text.trim();
    // A pasted label link: take the code after /scan/.
    final i = code.indexOf('/scan/');
    if (i >= 0) code = Uri.decodeComponent(code.substring(i + 6));
    if (code.isEmpty) {
      setState(() => _error = 'Enter the asset code printed on the label, e.g. EQ-0001.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _asset = null;
    });
    try {
      final d = asMap(await Api.get('/maintenance/asset-lookup/by-code/${Uri.encodeComponent(code)}'));
      if (mounted) setState(() => _asset = d);
    } catch (e) {
      if (mounted) setState(() => _error = ApiClient.describe(e));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final a = _asset;
    final openReq = asInt(a?['open_requests']) ?? 0;
    final openWo = asInt(a?['open_work_orders']) ?? 0;
    return SubPage(
      title: 'Asset Tag Scan',
      body: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: [
          MtHeader(str(a?['asset_code']).isNotEmpty ? str(a!['asset_code']) : 'Find an asset',
              caps: 'Asset Tag Scan', subtitle: 'Report a problem on this machine or open its record.'),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 4, 16, 12),
            child: Row(children: [
              Expanded(child: AppTextField(label: 'Asset code (from the QR label)', controller: _ctrl)),
              const SizedBox(width: 8),
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(80, 48)),
                onPressed: _loading ? null : _find,
                child: const Text('Find'),
              ),
            ]),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: ErrorBanner(_error!)),
          if (_loading) const LoadingView(),
          if (a != null) ...[
            DetailSection(str(a['name']), children: [
              Text([str(a['branch_name']), str(a['location_text'])].where((s) => s.isNotEmpty).join(' · '),
                  style: const TextStyle(color: Brand.muted)),
              const SizedBox(height: 8),
              Wrap(spacing: 8, children: [
                statusPill(assetStatusLabels, assetStatusHex, a['status']),
                Pill(criticalityLabels[a['criticality']] ?? 'Criticality ${a['criticality']}', critHex[a['criticality']] ?? kGrey),
              ]),
              const SizedBox(height: 10),
              Row(children: [
                Expanded(child: KpiTile(label: 'Open requests', value: '$openReq', color: openReq > 0 ? const Color(0xFFB45309) : null)),
                const SizedBox(width: 10),
                Expanded(child: KpiTile(label: 'Open work orders', value: '$openWo', color: openWo > 0 ? const Color(0xFFB45309) : null)),
              ]),
              if (openReq > 0 && a['can_raise_request'] == true)
                Padding(
                  padding: const EdgeInsets.only(top: 10),
                  child: Text(
                    'This machine already has ${openReq == 1 ? 'an open request' : '$openReq open requests'} — Maintenance may already be on it. Raise a new one only if this is a different problem.',
                    style: const TextStyle(fontSize: 12.5, color: Color(0xFFB45309)),
                  ),
                ),
            ]),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                if (a['can_raise_request'] == true)
                  FilledButton(onPressed: () => reportBreakdown(context, asset: a), child: const Text('Report Breakdown'))
                else
                  NoteBanner(
                    "${a['asset_code']} is decommissioned, so requests can't be raised on it. If it's back in use, ask Maintenance to reactivate it in the asset register.",
                    color: kGrey,
                  ),
                const SizedBox(height: 12),
                if (a['can_view_asset'] == true)
                  OutlinedButton(
                    style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                    onPressed: () => openScreen(context, AssetDetailScreen(id: asInt(a['id'])!)),
                    child: const Text('View Asset'),
                  ),
              ]),
            ),
          ],
        ],
      ),
    );
  }
}
