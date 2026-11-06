import 'package:flutter/material.dart';

import '../api/api.dart';
import '../theme.dart';
import 'format.dart';
import 'widgets.dart';

/// The portal's FormSheet (PM "Create Task" standard) on a phone: a
/// full-height sheet with the title, Cancel and a Save button, scrolling
/// fields, the server's error shown at the top, and no double save.
///
///     final saved = await showFormSheet(context,
///       title: 'New requisition',
///       saveLabel: 'Create',
///       builder: (ctx, setS) => [ AppTextField(...), AppSelect(...) ],
///       onSave: () async { await Api.post('/p2p/requisitions', data: {...}); },
///     );
///     if (saved) list.reload();
///
/// `onSave` throws a String for a local validation message, or lets the
/// API error through (its reason is shown).
Future<bool> showFormSheet(
  BuildContext context, {
  required String title,
  required List<Widget> Function(BuildContext context, StateSetter setState) builder,
  required Future<void> Function() onSave,
  String saveLabel = 'Save',
}) async {
  final ok = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: Colors.white,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
    builder: (_) => _FormSheet(title: title, builder: builder, onSave: onSave, saveLabel: saveLabel),
  );
  return ok == true;
}

class _FormSheet extends StatefulWidget {
  const _FormSheet({required this.title, required this.builder, required this.onSave, required this.saveLabel});
  final String title;
  final List<Widget> Function(BuildContext, StateSetter) builder;
  final Future<void> Function() onSave;
  final String saveLabel;

  @override
  State<_FormSheet> createState() => _FormSheetState();
}

class _FormSheetState extends State<_FormSheet> {
  bool _saving = false;
  String? _error;

  Future<void> _save() async {
    if (_saving) return;
    FocusScope.of(context).unfocus();
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await widget.onSave();
      if (mounted) Navigator.pop(context, true);
    } catch (e) {
      if (mounted) {
        setState(() {
          _saving = false;
          _error = e is String ? e : ApiClient.describe(e);
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
      child: FractionallySizedBox(
        heightFactor: 0.94,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(8, 8, 16, 8),
              child: Row(
                children: [
                  IconButton(
                    tooltip: 'Cancel',
                    icon: const Icon(Icons.close_rounded),
                    onPressed: _saving ? null : () => Navigator.pop(context, false),
                  ),
                  Expanded(
                    child: Text(widget.title,
                        style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700, color: Brand.heading)),
                  ),
                  FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size(88, 40)),
                    onPressed: _saving ? null : _save,
                    child: _saving
                        ? const SizedBox(
                            width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(widget.saveLabel),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),
            Expanded(
              child: StatefulBuilder(
                builder: (ctx, setS) => ListView(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 32),
                  children: [
                    if (_error != null) ...[ErrorBanner(_error!), const SizedBox(height: 16)],
                    for (final w in widget.builder(ctx, setS))
                      Padding(padding: const EdgeInsets.only(bottom: 14), child: w),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

InputDecoration fieldDecoration(String label, {bool required = false, String? hint, Widget? suffix}) {
  return InputDecoration(
    labelText: required ? '$label *' : label,
    hintText: hint,
    isDense: true,
    suffixIcon: suffix,
    filled: true,
    fillColor: Colors.white,
    border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
    enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(10), borderSide: const BorderSide(color: Brand.border)),
  );
}

/// Text / number / multi-line field.
class AppTextField extends StatelessWidget {
  const AppTextField({
    super.key,
    required this.label,
    this.controller,
    this.initialValue,
    this.onChanged,
    this.required = false,
    this.maxLines = 1,
    this.keyboardType,
    this.hint,
    this.enabled = true,
  });

  final String label;
  final TextEditingController? controller;
  final String? initialValue;
  final ValueChanged<String>? onChanged;
  final bool required;
  final int maxLines;
  final TextInputType? keyboardType;
  final String? hint;
  final bool enabled;

  /// Numeric keyboard with decimals.
  static const number = TextInputType.numberWithOptions(decimal: true);

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      initialValue: controller == null ? initialValue : null,
      onChanged: onChanged,
      maxLines: maxLines,
      minLines: maxLines > 1 ? 2 : 1,
      enabled: enabled,
      keyboardType: keyboardType ?? (maxLines > 1 ? TextInputType.multiline : null),
      decoration: fieldDecoration(label, required: required, hint: hint),
    );
  }
}

/// One choice for [AppSelect].
class Option<T> {
  const Option(this.value, this.label, {this.subtitle});
  final T value;
  final String label;
  final String? subtitle;
}

/// The portal's shared Select: looks like a field, opens a searchable list.
/// Give fixed [options], or [loadOptions] to fetch them (search text passed).
class AppSelect<T> extends StatelessWidget {
  const AppSelect({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.options,
    this.loadOptions,
    this.valueLabel,
    this.required = false,
    this.enabled = true,
    this.clearable = true,
  });

  final String label;
  final T? value;
  final ValueChanged<Option<T>?> onChanged;
  final List<Option<T>>? options;
  final Future<List<Option<T>>> Function(String search)? loadOptions;

  /// Text for the current value when it is not in [options] (loaded lists).
  final String? valueLabel;
  final bool required;
  final bool enabled;
  final bool clearable;

  String get _display {
    if (value == null) return '';
    for (final o in options ?? <Option<T>>[]) {
      if (o.value == value) return o.label;
    }
    return valueLabel ?? value.toString();
  }

  Future<void> _pick(BuildContext context) async {
    final picked = await showModalBottomSheet<_Picked<T>>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (_) => _SelectSheet<T>(
          title: label, options: options, loadOptions: loadOptions, current: value, clearable: clearable && !required),
    );
    if (picked != null) onChanged(picked.option);
  }

  @override
  Widget build(BuildContext context) {
    final text = _display;
    return InkWell(
      onTap: enabled ? () => _pick(context) : null,
      borderRadius: BorderRadius.circular(10),
      child: InputDecorator(
        isEmpty: text.isEmpty,
        decoration: fieldDecoration(label, required: required, suffix: const Icon(Icons.expand_more_rounded))
            .copyWith(enabled: enabled),
        child: Text(text, maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

class _Picked<T> {
  const _Picked(this.option);
  final Option<T>? option;
}

class _SelectSheet<T> extends StatefulWidget {
  const _SelectSheet({required this.title, this.options, this.loadOptions, this.current, required this.clearable});
  final String title;
  final List<Option<T>>? options;
  final Future<List<Option<T>>> Function(String)? loadOptions;
  final T? current;
  final bool clearable;

  @override
  State<_SelectSheet<T>> createState() => _SelectSheetState<T>();
}

class _SelectSheetState<T> extends State<_SelectSheet<T>> {
  String _search = '';
  List<Option<T>>? _loaded;
  Object? _error;
  int _token = 0;

  @override
  void initState() {
    super.initState();
    if (widget.loadOptions != null) _load();
  }

  Future<void> _load() async {
    final t = ++_token;
    setState(() => _error = null);
    try {
      final r = await widget.loadOptions!(_search);
      if (mounted && t == _token) setState(() => _loaded = r);
    } catch (e) {
      if (mounted && t == _token) setState(() => _error = e);
    }
  }

  @override
  Widget build(BuildContext context) {
    final all = widget.options ?? _loaded;
    final q = _search.toLowerCase();
    final shown = widget.loadOptions != null
        ? all
        : all?.where((o) => o.label.toLowerCase().contains(q) || (o.subtitle ?? '').toLowerCase().contains(q)).toList();
    return FractionallySizedBox(
      heightFactor: 0.8,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(widget.title,
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading)),
                ),
                if (widget.clearable && widget.current != null)
                  TextButton(onPressed: () => Navigator.pop(context, _Picked<T>(null)), child: const Text('Clear')),
                IconButton(icon: const Icon(Icons.close_rounded), onPressed: () => Navigator.pop(context)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: SearchField(
              hint: 'Search',
              onChanged: (v) {
                setState(() => _search = v);
                if (widget.loadOptions != null) _load();
              },
            ),
          ),
          const SizedBox(height: 8),
          Expanded(
            child: _error != null
                ? ErrorView(_error!, onRetry: _load)
                : shown == null
                    ? const LoadingView()
                    : shown.isEmpty
                        ? const EmptyView('No matches.')
                        : ListView.builder(
                            itemCount: shown.length,
                            itemBuilder: (ctx, i) {
                              final o = shown[i];
                              return ListTile(
                                title: Text(o.label),
                                subtitle: o.subtitle == null ? null : Text(o.subtitle!),
                                trailing: o.value == widget.current
                                    ? const Icon(Icons.check_rounded, color: Brand.primary)
                                    : null,
                                onTap: () => Navigator.pop(context, _Picked<T>(o)),
                              );
                            },
                          ),
          ),
        ],
      ),
    );
  }
}

/// Date field opening the date picker.
class DateField extends StatelessWidget {
  const DateField({
    super.key,
    required this.label,
    required this.value,
    required this.onChanged,
    this.required = false,
    this.firstDate,
    this.lastDate,
  });

  final String label;
  final DateTime? value;
  final ValueChanged<DateTime?> onChanged;
  final bool required;
  final DateTime? firstDate;
  final DateTime? lastDate;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      borderRadius: BorderRadius.circular(10),
      onTap: () async {
        final now = DateTime.now();
        final d = await showDatePicker(
          context: context,
          initialDate: value ?? now,
          firstDate: firstDate ?? DateTime(now.year - 10),
          lastDate: lastDate ?? DateTime(now.year + 10),
        );
        if (d != null) onChanged(d);
      },
      child: InputDecorator(
        isEmpty: value == null,
        decoration: fieldDecoration(label,
            required: required,
            suffix: value != null && !required
                ? IconButton(icon: const Icon(Icons.clear_rounded), onPressed: () => onChanged(null))
                : const Icon(Icons.calendar_today_outlined, size: 20)),
        child: Text(value == null ? '' : fmtDate(value), style: const TextStyle(fontSize: 15)),
      ),
    );
  }
}

/// Checkbox row.
class CheckField extends StatelessWidget {
  const CheckField({super.key, required this.label, required this.value, required this.onChanged});
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;

  @override
  Widget build(BuildContext context) => CheckboxListTile(
        contentPadding: EdgeInsets.zero,
        controlAffinity: ListTileControlAffinity.leading,
        title: Text(label),
        value: value,
        onChanged: (v) => onChanged(v ?? false),
      );
}

/// Throws a readable message when a required value is missing.
void requireField(Object? value, String label) {
  if (value == null || (value is String && value.trim().isEmpty)) {
    throw '$label is required - fill it in and save again.';
  }
}
