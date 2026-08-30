import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../api/api_exception.dart';
import '../models/ruling_job.dart';
import '../state/auth_provider.dart';
import '../state/ruling_jobs_provider.dart';
import '../widgets/inline_card_suggest_field.dart';
import '../widgets/ruling_turn_view.dart';
import 'correction_dialog.dart';
import 'paywall_screen.dart';

/// スレッド内の質問+回答をチャット風に時系列で表示し、末尾から追加質問
/// (フォローアップ)を送信できる画面。進行中のジョブはRulingJobsProvider.jobs
/// (ポーリング/プッシュ通知で更新される)とマージして表示する。
class RulingThreadDetailScreen extends StatefulWidget {
  final String threadId;

  const RulingThreadDetailScreen({super.key, required this.threadId});

  @override
  State<RulingThreadDetailScreen> createState() =>
      _RulingThreadDetailScreenState();
}

class _RulingThreadDetailScreenState extends State<RulingThreadDetailScreen> {
  final _questionController = TextEditingController();
  final _questionFocusNode = FocusNode();
  List<RulingJob> _historicalJobs = [];
  bool _loading = true;
  String? _loadError;
  bool _submitting = false;
  String? _submitError;

  @override
  void initState() {
    super.initState();
    _loadThread();
  }

  @override
  void dispose() {
    _questionController.dispose();
    _questionFocusNode.dispose();
    super.dispose();
  }

  Future<void> _loadThread() async {
    setState(() {
      _loading = true;
      _loadError = null;
    });
    try {
      final provider = context.read<RulingJobsProvider>();
      final deviceId = await provider.deviceIdProvider.getOrCreate();
      final detail = await provider.apiClient.getRulingThread(
        widget.threadId,
        deviceId,
      );
      if (!mounted) return;
      setState(() {
        _historicalJobs = detail.jobs;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loadError = e is ApiException ? e.friendlyMessage : '通信エラーが発生しました: $e';
        _loading = false;
      });
    }
  }

  Future<void> _submitFollowUp() async {
    final question = _questionController.text.trim();
    if (question.isEmpty) return;
    setState(() {
      _submitting = true;
      _submitError = null;
    });
    try {
      final jobId = await context.read<RulingJobsProvider>().submitFollowUp(
        widget.threadId,
        question,
      );
      if (!mounted) return;
      setState(() {
        _historicalJobs = [
          ..._historicalJobs,
          RulingJob(
            jobId: jobId,
            question: question,
            status: RulingJobStatus.pending,
            threadId: widget.threadId,
            createdAt: DateTime.now().millisecondsSinceEpoch,
          ),
        ];
        _questionController.clear();
      });
    } catch (e) {
      if (e is ApiException && e.isSubscriptionRequired) {
        final apiClient = context.read<RulingJobsProvider>().apiClient;
        final purchased = await Navigator.push<bool>(
          context,
          MaterialPageRoute(
            builder: (_) => PaywallScreen(apiClient: apiClient),
          ),
        );
        if (purchased == true) {
          // 購読完了後、同じ質問を自動的に再送信する。
          await _submitFollowUp();
          return;
        }
      } else {
        setState(() {
          _submitError = e is ApiException
              ? e.friendlyMessage
              : '通信エラーが発生しました: $e';
        });
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
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

  List<RulingJob> _mergedJobs(List<RulingJob> liveJobs) {
    final liveById = {for (final j in liveJobs) j.jobId: j};
    return _historicalJobs.map((h) => liveById[h.jobId] ?? h).toList();
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final liveJobs = context.watch<RulingJobsProvider>().jobs;
    final turns = _mergedJobs(liveJobs);
    final lastTurn = turns.isNotEmpty ? turns.last : null;
    final canSubmit = !_submitting && (lastTurn == null || lastTurn.isFinished);

    return Scaffold(
      appBar: AppBar(title: const Text('質問スレッド')),
      body: Column(
        children: [
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : _loadError != null
                ? Center(
                    child: Text(
                      _loadError!,
                      style: const TextStyle(color: Colors.red),
                    ),
                  )
                : ListView.separated(
                    padding: const EdgeInsets.all(16),
                    itemCount: turns.length,
                    separatorBuilder: (_, _) => const Divider(height: 32),
                    itemBuilder: (context, index) {
                      final job = turns[index];
                      return RulingTurnView(
                        job: job,
                        isLoggedIn: auth.isLoggedIn,
                        onCorrect: () => _openCorrectionDialog(job),
                      );
                    },
                  ),
          ),
          const Divider(height: 1),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!canSubmit)
                  const Padding(
                    padding: EdgeInsets.only(bottom: 8),
                    child: Text('前の質問の回答が完了してから、続けて質問できます。'),
                  ),
                InlineCardSuggestField(
                  apiClient: context.read<RulingJobsProvider>().apiClient,
                  controller: _questionController,
                  focusNode: _questionFocusNode,
                  maxLines: 4,
                  enabled: canSubmit,
                  decoration: const InputDecoration(
                    labelText: '追加で質問する',
                    helperText: '長押しでカード名を入力',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 8),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: canSubmit ? _submitFollowUp : null,
                    child: _submitting
                        ? const SizedBox(
                            width: 20,
                            height: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: Colors.white,
                            ),
                          )
                        : const Text('送信'),
                  ),
                ),
                if (_submitError != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _submitError!,
                    style: const TextStyle(color: Colors.red),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
