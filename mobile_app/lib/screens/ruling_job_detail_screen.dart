import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../models/ruling_job.dart';
import '../state/auth_provider.dart';
import '../state/ruling_jobs_provider.dart';
import '../widgets/ruling_result_view.dart';
import 'correction_dialog.dart';

/// 通知タップ、またはジョブ一覧タップで遷移する結果詳細画面。
/// RulingJobsProviderが保持するジョブ一覧を購読し、ポーリング/プッシュ通知
/// いずれの経路で状態が更新されても自動的に反映される。
class RulingJobDetailScreen extends StatefulWidget {
  final String jobId;

  const RulingJobDetailScreen({super.key, required this.jobId});

  @override
  State<RulingJobDetailScreen> createState() => _RulingJobDetailScreenState();
}

class _RulingJobDetailScreenState extends State<RulingJobDetailScreen> {
  @override
  void initState() {
    super.initState();
    // 通知タップ直後など、ローカルに保持しているジョブがまだ古い場合に備えて
    // 画面を開いた時点で一度サーバーへ再確認する。
    final provider = context.read<RulingJobsProvider>();
    Future.microtask(() => provider.refreshJob(widget.jobId));
  }

  void _openCorrectionDialog(RulingJob job) {
    if (job.result == null) return;
    showDialog(
      context: context,
      builder: (_) => CorrectionDialog(
        apiClient: context.read<RulingJobsProvider>().apiClient,
        originalQuestion: job.question,
        botConclusion: job.result!.conclusion,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final jobs = context.watch<RulingJobsProvider>().jobs;
    RulingJob? foundJob;
    for (final j in jobs) {
      if (j.jobId == widget.jobId) {
        foundJob = j;
        break;
      }
    }
    final job = foundJob;

    return Scaffold(
      appBar: AppBar(title: const Text('裁定結果')),
      body: job == null
          ? const Center(child: Text('この質問の情報が見つかりませんでした。'))
          : SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (job.question.isNotEmpty) ...[
                    Text('質問', style: Theme.of(context).textTheme.labelLarge),
                    const SizedBox(height: 4),
                    SelectableText(job.question),
                    const SizedBox(height: 16),
                  ],
                  if (!job.isFinished) ...[
                    const Center(child: CircularProgressIndicator()),
                    const SizedBox(height: 8),
                    const Center(child: Text('裁定を生成しています…')),
                  ] else if (job.status == RulingJobStatus.failed) ...[
                    Text(
                      job.error ?? '裁定生成中にエラーが発生しました。',
                      style: const TextStyle(color: Colors.red),
                    ),
                  ] else if (job.result != null) ...[
                    RulingResultView(result: job.result!),
                    if (auth.isLoggedIn) ...[
                      const SizedBox(height: 8),
                      OutlinedButton(
                        onPressed: () => _openCorrectionDialog(job),
                        child: const Text('この裁定を訂正する'),
                      ),
                    ],
                  ],
                ],
              ),
            ),
    );
  }
}
