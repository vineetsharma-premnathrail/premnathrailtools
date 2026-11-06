import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/form.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'crm_common.dart';

const productTypeLabels = {
  'vehicle': 'Rail-road vehicle',
  'machine': 'Machine',
  'equipment': 'Equipment',
  'attachment': 'Attachment / accessory',
  'service': 'Paid service',
  'application': 'Application',
};
const productStatusLabels = {
  'development': 'In development',
  'active': 'Active',
  'phased_out': 'Phased out',
  'discontinued': 'Discontinued',
};
const productStatusColors = {
  'development': Color(0xFF2563EB),
  'active': Color(0xFF16A34A),
  'phased_out': Color(0xFFF59E0B),
  'discontinued': Color(0xFF78716C),
};

Widget productStatusPill(Object? s) => pill(productStatusLabels[str(s)] ?? str(s), productStatusColors[str(s)] ?? Brand.muted);

const currencyOptions = [
  Option('INR', 'INR - Indian Rupee'),
  Option('USD', 'USD - US Dollar'),
  Option('EUR', 'EUR - Euro'),
  Option('GBP', 'GBP - British Pound'),
  Option('AED', 'AED - UAE Dirham'),
  Option('SGD', 'SGD - Singapore Dollar'),
];

String moneyIn(Object? amount, String currency) {
  final n = asNum(amount);
  if (n == null) return '—';
  return currency == 'INR' ? '₹${fmtAmount(n)}' : '$currency ${fmtAmount(n)}';
}

/// CRM › Products list (products/page.tsx).
class ProductsTab extends StatefulWidget {
  const ProductsTab({super.key});

  @override
  State<ProductsTab> createState() => _ProductsTabState();
}

class _ProductsTabState extends State<ProductsTab> {
  final _list = GlobalKey<ApiListViewState>();
  String _type = '';
  String _status = '';
  List<Json> _all = const [];
  String? _loadedFor;

  Future<ApiPage> _load(int page, String search) async {
    if (_loadedFor != '$search|$_type') {
      final rows = (await Api.list('/products', query: {'search': search, 'product_type': _type})).rows
        ..sort((a, b) => str(a['code']).toLowerCase().compareTo(str(b['code']).toLowerCase()));
      if (mounted) {
        setState(() {
          _all = rows;
          _loadedFor = '$search|$_type';
        });
      }
    }
    return ApiPage(_all.where((p) => _status.isEmpty || p['status'] == _status).toList());
  }

  void _reloadAll() {
    _loadedFor = null;
    _list.currentState?.reload();
  }

  Future<void> _create() async {
    final saved = await showProductForm(context);
    if (saved == null || !mounted) return;
    _reloadAll();
    openScreen(context, ProductScreen(id: asInt(saved['id'])!, onChanged: _reloadAll));
  }

  @override
  Widget build(BuildContext context) {
    final header = Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      SizedBox(
        height: 44,
        child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 16), children: [
          CountChip('All statuses', _all.length, selected: _status.isEmpty, onTap: () {
            setState(() => _status = '');
            _list.currentState?.reload();
          }),
          for (final e in productStatusLabels.entries)
            CountChip(e.value, _all.where((p) => p['status'] == e.key).length,
                color: productStatusColors[e.key], selected: _status == e.key, onTap: () {
              setState(() => _status = _status == e.key ? '' : e.key);
              _list.currentState?.reload();
            }),
        ]),
      ),
      Padding(
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 8),
        child: AppSelect<String>(
          label: 'Type',
          value: _type.isEmpty ? null : _type,
          options: [for (final e in productTypeLabels.entries) Option(e.key, e.value)],
          onChanged: (o) {
            setState(() => _type = o?.value ?? '');
            _list.currentState?.reload();
          },
        ),
      ),
    ]);
    return Scaffold(
      backgroundColor: Brand.background,
      floatingActionButton: CrmPerm.can('products', 'create') ? CreateFab(label: 'New Product', onPressed: _create) : null,
      body: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const PageHeader('Products', subtitle: 'CRM › Products'),
        Expanded(
          child: ApiListView(
            key: _list,
            searchHint: 'Search code, name or model…',
            header: header,
            emptyText: _type.isNotEmpty || _status.isNotEmpty
                ? 'No products match these filters.'
                : 'No products yet — add your first finished product (e.g. RRB Sanding Vehicle).',
            load: _load,
            itemBuilder: (ctx, p, reload) => RecordCard(
              code: str(p['code']),
              title: str(p['name']),
              trailing: Padding(padding: const EdgeInsets.only(left: 8), child: productStatusPill(p['status'])),
              meta: [
                ('Type', productTypeLabels[str(p['product_type'])] ?? str(p['product_type'])),
                ('Model', txt(p['model_number'])),
              ],
              onTap: () => openScreen(ctx, ProductScreen(id: asInt(p['id'])!, onChanged: _reloadAll)),
            ),
          ),
        ),
      ]),
    );
  }
}

/// Product detail (products/[id]/page.tsx).
class ProductScreen extends StatefulWidget {
  const ProductScreen({super.key, required this.id, this.onChanged});
  final int id;
  final VoidCallback? onChanged;

  @override
  State<ProductScreen> createState() => _ProductScreenState();
}

class _ProductScreenState extends State<ProductScreen> {
  Json? _p;
  Object? _error;
  int _pricingKey = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.get('/products/${widget.id}');
      if (mounted) {
        setState(() {
          _p = Map<String, dynamic>.from(p as Map);
          _error = null;
          _pricingKey++;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  Future<void> _delete() async {
    final p = _p!;
    final yes = await confirmDialog(context,
        title: 'Delete product?',
        message: "${p['code']} — ${p['name']} will be permanently deleted with its specifications. This can't be undone.",
        confirmLabel: 'Delete',
        danger: true);
    if (!yes || !mounted) return;
    if (await crmRun(context, () => Api.delete('/products/${widget.id}'), success: 'Product deleted.')) {
      widget.onChanged?.call();
      if (mounted) Navigator.pop(context);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (p == null) {
      return SubPage(title: 'Product', body: _error != null ? ErrorView(crmError(_error!), onRetry: _load) : const LoadingView());
    }
    final spec = str(p['technical_specification']).isNotEmpty
        ? str(p['technical_specification'])
        : jsonList(p['specifications']).map((r) => '${r['parameter']}: ${r['value']}${str(r['unit']).isEmpty ? '' : ' ${r['unit']}'}').join('\n');
    final buttons = <Widget>[
      if (p['status'] == 'development' && CrmPerm.canDelete('products', p['created_by_id'])) dangerBtn('Delete', _delete),
      if (CrmPerm.can('products', 'edit'))
        primaryBtn('Edit', () async {
          if (await showProductForm(context, initial: p) != null) {
            widget.onChanged?.call();
            _load();
          }
        }),
    ];
    return SubPage(
      title: '${p['code']} — ${p['name']}',
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.only(top: 12, bottom: 24), children: [
          DetailSection(str(p['name']), children: [
            if (str(p['short_description']).isNotEmpty) Text(str(p['short_description'])),
            const SizedBox(height: 6),
            Wrap(spacing: 8, runSpacing: 4, crossAxisAlignment: WrapCrossAlignment.center, children: [
              productStatusPill(p['status']),
              Text('Code ${p['code']}', style: const TextStyle(fontSize: 12.5)),
              Text(productTypeLabels[str(p['product_type'])] ?? str(p['product_type']), style: const TextStyle(fontSize: 12.5)),
              if (str(p['created_by_name']).isNotEmpty) Text('Created by ${p['created_by_name']}', style: const TextStyle(fontSize: 12.5, color: Brand.muted)),
            ]),
          ]),
          DetailSection('Master data', children: [
            row('Model number', p['model_number']),
            row('Unit', p['uom']),
            row('HSN code', p['hsn_code']),
            row('Warranty', p['warranty_months'] == null ? null : '${p['warranty_months']} months'),
            row('Store item', str(p['store_item_code']).isEmpty ? 'Not linked' : '${p['store_item_code']} — ${p['store_item_name']}'),
          ]),
          DetailSection('Description', children: [row('Description', p['description'])]),
          if (CrmPerm.feat('products', 'specifications', 'view'))
            DetailSection('Technical specifications', children: [Text(spec.isEmpty ? 'No specifications recorded yet.' : spec)]),
          if (CrmPerm.feat('products', 'prices', 'view') && CrmPerm.feat('products', 'pricing', 'view'))
            DetailSection('Pricing', children: [
              const Note(
                  "List price and country-wise prices for this product. Quotations take the price of the customer's country, else the list price; with no price the line is priced per quotation."),
              const SizedBox(height: 8),
              PriceConditionsPanel(key: ValueKey(_pricingKey), productId: widget.id),
            ]),
        ]),
      ),
      bottom: buttons.isEmpty ? null : actionBar(buttons),
    );
  }
}

/// Country-wise prices of one product (components/products/PriceConditionsPanel.tsx, product-locked).
class PriceConditionsPanel extends StatefulWidget {
  const PriceConditionsPanel({super.key, required this.productId});
  final int productId;

  @override
  State<PriceConditionsPanel> createState() => _PriceConditionsPanelState();
}

class _PriceConditionsPanelState extends State<PriceConditionsPanel> {
  List<Json>? _rows;
  Object? _error;
  String _country = '';
  bool _currentOnly = true;

  bool get _canCreate => CrmPerm.feat('products', 'pricing', 'create');
  bool get _canEdit => CrmPerm.feat('products', 'pricing', 'edit');
  bool get _canDel => CrmPerm.feat('products', 'pricing', 'delete');

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final rows = (await Api.list('/products/price-conditions', query: {'current_only': _currentOnly, 'product_id': widget.productId}))
          .rows
          .where((c) => _country.isEmpty || (_country == '__list__' ? str(c['country']).isEmpty : c['country'] == _country))
          .toList();
      if (mounted) {
        setState(() {
          _rows = rows;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = e);
    }
  }

  String _value(Json c) => c['condition_type'] == 'price'
      ? '${moneyIn(c['amount'], str(c['currency']).isEmpty ? 'INR' : str(c['currency']))}${str(c['uom']).isEmpty ? '' : ' / ${c['uom']}'}'
      : c['condition_type'] == 'discount'
          ? '${c['percent']}%'
          : c['freight_basis'] == 'percent'
              ? '${c['percent']}% of value'
              : '${moneyIn(c['amount'], str(c['currency']))} / order';

  Future<void> _actions(Json c) async {
    final choice = await showModalBottomSheet<String>(
      context: context,
      backgroundColor: Colors.white,
      builder: (ctx) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.currency_exchange_rounded), title: const Text('In other currencies'), onTap: () => Navigator.pop(ctx, 'fx')),
          if (_canEdit) ListTile(leading: const Icon(Icons.edit_outlined), title: const Text('Edit'), onTap: () => Navigator.pop(ctx, 'edit')),
          if (_canEdit && c['is_current'] == true && c['valid_to'] == null)
            ListTile(leading: const Icon(Icons.event_busy_outlined), title: const Text('End today'), onTap: () => Navigator.pop(ctx, 'end')),
          if (_canDel)
            ListTile(
                leading: const Icon(Icons.delete_outline_rounded, color: Brand.danger),
                title: const Text('Delete', style: TextStyle(color: Brand.danger)),
                onTap: () => Navigator.pop(ctx, 'delete')),
        ]),
      ),
    );
    if (!mounted || choice == null) return;
    switch (choice) {
      case 'fx':
        _showConversions(asNum(c['amount']), str(c['currency']).isEmpty ? 'INR' : str(c['currency']));
      case 'edit':
        if (await _form(c)) _load();
      case 'end':
        if (await crmRun(context, () => Api.patch('/products/price-conditions/${c['id']}', data: {'valid_to': todayIso()}), success: 'Price ended today.')) {
          _load();
        }
      case 'delete':
        final yes = await confirmDialog(context,
            title: 'Delete price',
            message:
                'Delete Price for ${str(c['item_label'])}? Lines already priced from it keep their price. To stop using it from a date, use "End today" instead.',
            confirmLabel: 'Delete',
            danger: true);
        if (yes && mounted && await crmRun(context, () => Api.delete('/products/price-conditions/${c['id']}'), success: 'Price deleted.')) _load();
    }
  }

  Future<void> _showConversions(num? amount, String currency) async {
    if (amount == null || amount <= 0) return;
    try {
      final d = await Api.get('/products/price-conditions/convert', query: {'amount': amount, 'currency': currency});
      final rows = jsonList(d is Map ? d['rows'] : null).where((r) => r['currency'] != currency).toList();
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('In other currencies (Finance rate of the day)'),
          content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            if (rows.isEmpty) const Text('No other currency in Finance › Masters › Currencies & FX yet.'),
            for (final r in rows)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 3),
                child: Text('${r['currency']}${str(r['name']).isEmpty ? '' : ' — ${r['name']}'}: '
                    '${r['amount'] != null ? moneyIn(r['amount'], str(r['currency'])) : str(r['note'])}'),
              ),
          ]),
          actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Close'))],
        ),
      );
    } catch (e) {
      if (mounted) showSnack(context, 'Could not convert the price into other currencies. ${crmError(e)}', error: true);
    }
  }

  Future<bool> _form([Json? c]) async {
    final isEdit = c != null;
    var country = str(c?['country']);
    var currency = str(c?['currency']).isEmpty ? 'INR' : str(c!['currency']);
    final amount = TextEditingController(text: c?['amount'] == null ? '' : fmtQty(c!['amount']));
    final minPrice = TextEditingController(text: c?['min_price'] == null ? '' : fmtQty(c!['min_price']));
    final uom = TextEditingController(text: str(c?['uom']));
    DateTime? from = dateOf(c?['valid_from']) ?? DateTime.now();
    DateTime? to = dateOf(c?['valid_to']);
    final remarks = TextEditingController(text: str(c?['remarks']));
    String currencyFor(String ctry) {
      const euro = ['Austria', 'Belgium', 'Croatia', 'Cyprus', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Ireland', 'Italy', 'Latvia',
        'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Portugal', 'Slovakia', 'Slovenia', 'Spain'];
      if (ctry.isEmpty || ctry == 'India') return 'INR';
      if (euro.contains(ctry)) return 'EUR';
      return const {'United States': 'USD', 'United Kingdom': 'GBP', 'United Arab Emirates': 'AED', 'Singapore': 'SGD'}[ctry] ?? 'USD';
    }

    return showFormSheet(
      context,
      title: isEdit ? 'Change Price' : 'New Price',
      saveLabel: 'Save',
      builder: (ctx, setS) => [
        Note(isEdit ? 'Price for ${str(c['item_label'])}' : 'A validity-dated price that documents default from.'),
        const FormSection('Price'),
        if (isEdit)
          FieldRow('Country', country.isEmpty ? 'All countries' : country)
        else
          AppSelect<String>(
            label: 'Country (optional)',
            value: country.isEmpty ? null : country,
            options: opts(CrmLists.countries.where((x) => x != 'Other')),
            onChanged: (o) => setS(() {
              country = o?.value ?? '';
              currency = currencyFor(country);
            }),
          ),
        const Note('Blank = the list price for every country. A country price applies to every customer whose CRM organisation is in that country and wins over the list price.'),
        const FormSection('Value'),
        AppTextField(label: 'Rate ($currency)', controller: amount, keyboardType: AppTextField.number),
        AppTextField(label: 'Min. price ($currency)', controller: minPrice, keyboardType: AppTextField.number),
        AppSelect<String>(
          label: 'Currency',
          value: currency,
          clearable: false,
          options: [...currencyOptions, if (!currencyOptions.any((o) => o.value == currency)) Option(currency, currency)],
          onChanged: (o) => setS(() => currency = o?.value ?? currency),
        ),
        AppTextField(label: 'Unit', controller: uom),
        const FormSection('Validity'),
        DateField(label: 'Valid from', required: true, value: from, onChanged: (d) => setS(() => from = d)),
        DateField(label: 'Valid to (optional)', value: to, onChanged: (d) => setS(() => to = d)),
        const Note('Leave "Valid to" blank for an open-ended price.'),
        AppTextField(label: 'Remarks', controller: remarks, hint: 'e.g. Rate contract RC/2026/12'),
      ],
      onSave: () async {
        if (from == null) throw 'Valid from is required - fill it in and save again.';
        double? n(String v) => v.trim().isEmpty ? null : double.tryParse(v.trim());
        final body = <String, dynamic>{
          'amount': n(amount.text),
          'percent': null,
          'freight_basis': 'per_order',
          'min_price': n(minPrice.text),
          'uom': uom.text.trim().isEmpty ? null : uom.text.trim(),
          'currency': currency,
          'valid_from': apiDate(from!),
          'valid_to': to == null ? null : apiDate(to!),
          'remarks': remarks.text.trim().isEmpty ? null : remarks.text.trim(),
        };
        await guard(() => isEdit
            ? Api.patch('/products/price-conditions/${c['id']}', data: body)
            : Api.post('/products/price-conditions', data: {
                ...body,
                'condition_type': 'price',
                'item_kind': 'product',
                'product_id': widget.productId,
                'country': country.isEmpty ? null : country,
              }));
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_error != null && _rows == null) return ErrorBanner('Could not load the prices. ${crmError(_error!)}');
    final rows = _rows;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      AppSelect<String>(
        label: 'Country',
        value: _country.isEmpty ? null : _country,
        valueLabel: _country == '__list__' ? 'List price (no country)' : null,
        options: [const Option('__list__', 'List price (no country)'), ...opts(CrmLists.countries.where((x) => x != 'Other'))],
        onChanged: (o) {
          setState(() => _country = o?.value ?? '');
          _load();
        },
      ),
      CheckField(
          label: 'Valid today only',
          value: _currentOnly,
          onChanged: (v) {
            setState(() => _currentOnly = v);
            _load();
          }),
      if (_canCreate)
        Align(
          alignment: Alignment.centerLeft,
          child: primaryBtn('+ New price', () async {
            if (await _form()) _load();
          }),
        ),
      const SizedBox(height: 8),
      if (rows == null)
        const LoadingView()
      else if (rows.isEmpty)
        Note('No prices for this product${_currentOnly ? ' valid today' : ''}.')
      else
        for (final c in rows)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(_value(c), style: const TextStyle(fontWeight: FontWeight.w600)),
            subtitle: Text([
              str(c['country']).isEmpty ? 'All countries (list price)' : str(c['country']),
              if (c['min_price'] != null) 'Min. ${moneyIn(c['min_price'], str(c['currency']))}',
              '${fmtDate(c['valid_from'])} → ${c['valid_to'] == null ? 'Open' : fmtDate(c['valid_to'])}',
              if (str(c['remarks']).isNotEmpty) str(c['remarks']),
            ].join('\n')),
            isThreeLine: true,
            trailing: const Icon(Icons.more_vert_rounded),
            onTap: () => _actions(c),
          ),
    ]);
  }
}

/// Create / edit product (components/products/ProductForm.tsx). Returns the saved product.
Future<Json?> showProductForm(BuildContext context, {Json? initial}) async {
  final isEdit = initial != null;
  List<Json> types = const [];
  List<Json> statuses = const [];
  try {
    final m = await Api.get('/products/meta');
    if (m is Map) {
      types = jsonList(m['types']);
      statuses = jsonList(m['statuses']);
    }
  } catch (e) {
    if (context.mounted) showSnack(context, 'Failed to load product types. ${crmError(e)}', error: true);
  }
  if (types.isEmpty) types = [for (final e in productTypeLabels.entries) {'value': e.key, 'label': e.value}];
  if (statuses.isEmpty) statuses = [for (final e in productStatusLabels.entries) {'value': e.key, 'label': e.value}];
  List<Json> offered(List<Json> rows, Object? current) => rows.where((r) => r['allowed'] != false || r['value'] == current).toList();
  final typeRows = offered(types, initial?['product_type']);
  final statusRows = offered(statuses, initial?['status']);
  final productTypes = typeRows.where((t) => t['value'] != 'application').toList();
  final mayApp = typeRows.any((t) => t['value'] == 'application');
  if (!context.mounted) return null;

  var type = str(initial?['product_type']).isEmpty
      ? (productTypes.isEmpty ? 'vehicle' : str(productTypes.first['value']))
      : str(initial!['product_type']);
  var status = str(initial?['status']).isEmpty
      ? (statusRows.any((s) => s['value'] == 'development') ? 'development' : (statusRows.isEmpty ? 'development' : str(statusRows.first['value'])))
      : str(initial!['status']);
  final code = TextEditingController(text: str(initial?['code']));
  final name = TextEditingController(text: str(initial?['name']));
  final model = TextEditingController(text: str(initial?['model_number']));
  final short = TextEditingController(text: str(initial?['short_description']));
  final desc = TextEditingController(text: str(initial?['description']));
  final spec = TextEditingController(
      text: str(initial?['technical_specification']).isNotEmpty
          ? str(initial!['technical_specification'])
          : jsonList(initial?['specifications']).map((r) => '${r['parameter']}: ${r['value']}${str(r['unit']).isEmpty ? '' : ' ${r['unit']}'}').join('\n'));
  final uom = TextEditingController(text: str(initial?['uom']).isEmpty ? 'Nos' : str(initial!['uom']));
  final hsn = TextEditingController(text: str(initial?['hsn_code']));
  final warranty = TextEditingController(text: initial?['warranty_months'] == null ? '' : str(initial!['warranty_months']));
  int? storeItemId = asInt(initial?['store_item_id']);
  String? storeItemLabel = storeItemId == null ? null : '${initial!['store_item_code']} — ${initial['store_item_name']}';
  final listPrice = TextEditingController();
  var priceCurrency = 'INR';
  final itemHsn = <int, String>{};
  Json? saved;

  final ok = await showFormSheet(
    context,
    title: isEdit ? 'Edit ${initial['code']}' : (type == 'application' ? 'New Application' : 'New Product'),
    saveLabel: isEdit ? 'Save changes' : 'Create product',
    builder: (ctx, setS) {
      final isApp = type == 'application';
      return [
        Note(isEdit
            ? '${initial['name']} — the code is fixed once created.'
            : isApp
                ? 'An add-on sold with a product only when the customer asks for it.'
                : 'A finished product the company sells — the master CRM, Design, Production and Service refer to.'),
        FormSection(isApp ? 'Application' : 'Product'),
        if (!isEdit && mayApp && productTypes.isNotEmpty)
          SegmentedButton<bool>(
            segments: const [ButtonSegment(value: false, label: Text('Product')), ButtonSegment(value: true, label: Text('Application'))],
            selected: {isApp},
            onSelectionChanged: (s) => setS(() => type = s.first ? 'application' : str(productTypes.first['value'])),
          ),
        AppTextField(label: 'Code', required: true, controller: code, enabled: !isEdit, hint: 'RRB-SV'),
        AppTextField(label: 'Name', required: true, controller: name, hint: 'RRB Sanding Vehicle'),
        if (!isApp) ...[
          AppSelect<String>(
            label: 'Type',
            value: type,
            clearable: false,
            options: [for (final t in productTypes) Option(str(t['value']), str(t['label']))],
            onChanged: (o) => setS(() => type = o?.value ?? type),
          ),
          AppTextField(label: 'Model number', controller: model, hint: 'PRT-SV-01'),
        ],
        AppSelect<String>(
          label: 'Status',
          value: status,
          clearable: false,
          options: [for (final s in statusRows) Option(str(s['value']), str(s['label']))],
          onChanged: (o) => setS(() => status = o?.value ?? status),
        ),
        const Note('Only Active products should be quoted and sold. Phased out = still serviced, not sold new. A product can be deleted only while it is In development.'),
        const FormSection('Description'),
        AppTextField(
            label: 'Short description (one line, for quotations)', controller: short, hint: 'Self-propelled road-rail vehicle for rail-head sanding'),
        AppTextField(label: 'Detailed description', controller: desc, maxLines: 4),
        const FormSection('Technical specifications (optional)'),
        AppTextField(
            label: 'Technical specifications',
            controller: spec,
            maxLines: 6,
            hint: 'One specification per line, e.g.\nMax speed on rail: 40 km/h\nEngine: 4-cylinder diesel, 110 HP'),
        const Note('Write each specification on its own line — it prints the same way on quotations and the product page.'),
        if (!isEdit && CrmPerm.feat('products', 'pricing', 'view')) ...[
          const FormSection('Pricing (optional)'),
          if (CrmPerm.feat('products', 'pricing', 'create')) ...[
            AppTextField(label: 'List price ($priceCurrency)', controller: listPrice, keyboardType: AppTextField.number, hint: '5000000'),
            AppSelect<String>(
                label: 'Currency',
                value: priceCurrency,
                clearable: false,
                options: currencyOptions,
                onChanged: (o) => setS(() => priceCurrency = o?.value ?? priceCurrency)),
            const Note(
                'The price for all customers from today. After saving, open the product to add customer or country prices (e.g. a different price for Bangladesh in USD).'),
          ] else
            const Note("Adding prices needs 'Create' on CRM › Products › Pricing — ask an admin to add it to your role."),
        ],
        const FormSection('Sales & service defaults'),
        AppTextField(label: 'Unit', controller: uom),
        AppTextField(label: 'HSN code', controller: hsn, hint: '8604'),
        AppTextField(label: 'Warranty (months)', controller: warranty, keyboardType: TextInputType.number, hint: '12'),
        AppSelect<int>(
          label: 'Finished-good store item',
          value: storeItemId,
          valueLabel: storeItemLabel,
          loadOptions: (q) async {
            if (q.trim().isEmpty) return const <Option<int>>[];
            final rows = (await Api.list('/products/lookups/store-items', query: {'search': q.trim()})).rows;
            for (final r in rows) {
              if (asInt(r['id']) != null) itemHsn[asInt(r['id'])!] = str(r['hsn_sac_code']);
            }
            return [
              for (final r in rows)
                if (asInt(r['id']) != null)
                  Option(asInt(r['id'])!, '${r['item_code']} — ${r['item_name']}', subtitle: str(r['uom']).isEmpty ? null : str(r['uom'])),
            ];
          },
          onChanged: (o) => setS(() {
            storeItemId = o?.value;
            storeItemLabel = o?.label;
            if (o != null && hsn.text.trim().isEmpty && (itemHsn[o.value] ?? '').isNotEmpty) hsn.text = itemHsn[o.value]!;
          }),
        ),
        const Note('The store item is the stock/BOM code Design, Production and Projects use for this product. Search by item code or name.'),
      ];
    },
    onSave: () async {
      if (code.text.trim().isEmpty || name.text.trim().isEmpty) {
        throw 'Product code and name are required — e.g. code RRB-SV, name RRB Sanding Vehicle.';
      }
      final payload = <String, dynamic>{
        if (!isEdit) 'code': code.text.trim(),
        'name': name.text.trim(),
        'product_type': type,
        'model_number': model.text.trim(),
        'status': status,
        'short_description': short.text.trim(),
        'description': desc.text.trim(),
        'hsn_code': hsn.text.trim(),
        'uom': uom.text.trim().isEmpty ? 'Nos' : uom.text.trim(),
        'warranty_months': warranty.text.trim().isEmpty ? null : int.tryParse(warranty.text.trim()),
        'store_item_id': storeItemId,
        'technical_specification': spec.text.trim().isEmpty ? null : spec.text.trim(),
      };
      final r = await guard(() => isEdit ? Api.patch('/products/${initial['id']}', data: payload) : Api.post('/products', data: payload));
      saved = r is Map ? Map<String, dynamic>.from(r) : null;
      if (!isEdit && listPrice.text.trim().isNotEmpty && saved != null) {
        try {
          await Api.post('/products/price-conditions', data: {
            'condition_type': 'price',
            'item_kind': 'product',
            'product_id': saved!['id'],
            'amount': double.tryParse(listPrice.text.trim()),
            'currency': priceCurrency,
            'valid_from': todayIso(),
          });
        } catch (e) {
          if (context.mounted) {
            showSnack(context,
                "${saved!['code']} was saved, but its list price wasn't: ${crmError(e)} Open the product and add the price in its Pricing section.",
                error: true);
          }
        }
      }
    },
  );
  return ok ? saved : null;
}
