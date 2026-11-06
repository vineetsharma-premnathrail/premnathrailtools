import 'package:flutter/material.dart';

import '../../modules.dart';
import '../../ui/app_frame.dart';
import '../../ui/widgets.dart';

/// HR & Administration - native copy of frontend/src/app/dashboard/hr/.
class HrModuleHome extends StatelessWidget {
  const HrModuleHome({super.key, required this.module});
  final ErpModule module;

  @override
  Widget build(BuildContext context) => ModuleScaffold(module: module, tabs: [
        ModuleTab(label: 'Overview', builder: (_) => const EmptyView('This module is being built for the app.')),
      ]);
}
