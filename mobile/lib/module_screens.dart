import 'package:flutter/widgets.dart';

import 'modules.dart';
import 'modules/crm/crm_module.dart';
import 'modules/design/design_module.dart';
import 'modules/electrical/electrical_module.dart';
import 'modules/erp/erp_module.dart';
import 'modules/finance/finance_module.dart';
import 'modules/hr/hr_module.dart';
import 'modules/hydraulic/hydraulic_module.dart';
import 'modules/maintenance/maintenance_module.dart';
import 'modules/organization/organization_module.dart';
import 'modules/p2p/p2p_module.dart';
import 'modules/production/production_module.dart';
import 'modules/projects/projects_module.dart';
import 'modules/quality/quality_module.dart';
import 'modules/rnd/rnd_module.dart';
import 'modules/store/store_module.dart';

/// Module key → its main screen. Each module lives in `lib/modules/<key>/`.
final Map<String, Widget Function(ErpModule)> moduleScreens = {
  'erp': (m) => ServiceModuleHome(module: m),
  'rnd': (m) => RndModuleHome(module: m),
  'crm': (m) => CrmModuleHome(module: m),
  'p2p': (m) => ProcurementModuleHome(module: m),
  'store': (m) => StoreModuleHome(module: m),
  'projects': (m) => ProjectsModuleHome(module: m),
  'finance': (m) => FinanceModuleHome(module: m),
  'organization': (m) => OrganizationModuleHome(module: m),
  'production': (m) => ProductionModuleHome(module: m),
  'maintenance': (m) => MaintenanceModuleHome(module: m),
  'electrical': (m) => ElectricalModuleHome(module: m),
  'hydraulic': (m) => HydraulicModuleHome(module: m),
  'hr': (m) => HrModuleHome(module: m),
  'quality': (m) => QualityModuleHome(module: m),
  'design': (m) => DesignModuleHome(module: m),
};
