import 'package:flutter/material.dart';

import '../../api/api.dart';
import '../../theme.dart';
import '../../ui/app_frame.dart';
import '../../ui/format.dart';
import '../../ui/widgets.dart';
import 'rnd_common.dart';
import 'rnd_projects.dart';
import 'rnd_task_board.dart';

/// R&D tasks on a past machine (PEW-1.. serial) of Project Management › All Projects
/// (portal: rnd/machine-tasks/[id]). Works like [PmProjectTasksScreen].
class MachineTasksScreen extends StatelessWidget {
  const MachineTasksScreen({super.key, required this.machineId});
  final int machineId;

  @override
  Widget build(BuildContext context) {
    return SubPage(
      title: 'R&D Tasks',
      body: ApiLoader<Json>(
        load: () async => jsonMap(await Api.get('/rnd/machines/$machineId/task-access')),
        builder: (ctx, a, reload) {
          // The machine card may come as "machine" or "project"; serial and title spellings differ.
          final m = a['machine'] != null ? jsonMap(a['machine']) : jsonMap(a['project']);
          final canManage = boolOf(a['can_manage']);
          final serial = str(m, 'project_number') ?? str(m, 'project_code') ?? '';
          final title = str(m, 'title') ?? str(m, 'name') ?? '';
          final sub = [
            str(m, 'client_name'),
            m['status'] != null ? 'Status: ${humanize(m['status'])}' : null,
          ].whereType<String>().join(' · ');
          return Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Container(
                color: Colors.white,
                padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title.isEmpty ? serial : '$serial — $title',
                      style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w700, color: Brand.heading),
                    ),
                    Text(
                      sub.isEmpty ? 'Project Management › All Projects' : sub,
                      style: const TextStyle(fontSize: 13, color: Brand.muted),
                    ),
                  ],
                ),
              ),
              Expanded(
                child: TasksBoard(
                  api: RndTaskApi.machine(machineId),
                  canManage: canManage,
                  canCreate: canManage && RndPerm.feature('projects', 'tasks', 'create'),
                  labels: const TaskLabels(
                    manager: 'R&D head / project manager',
                    emptyManager: 'No R&D tasks on this machine yet — use “Add Task”.',
                    emptyOther: 'You have no R&D tasks on this machine.',
                  ),
                  rights: projectTaskRights(),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
