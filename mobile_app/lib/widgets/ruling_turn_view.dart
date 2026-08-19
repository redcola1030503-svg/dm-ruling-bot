import 'package:flutter/material.dart';

import '../models/ruling_job.dart';
import 'loading_banner_ad.dart';
import 'ruling_result_view.dart';

/// 1つの質問+回答(1ターン分)の表示。RulingJobDetailScreen・
/// RulingThreadDetailScreenの両方から使う共通ウィジェット。
class RulingTurnView extends StatelessWidget {
  final RulingJob job;
  final bool showQuestion;
  final bool isLoggedIn;
  final VoidCallback? onCorrect;

  const RulingTurnView({
    super.key,
    required this.job,
    this.showQuestion = true,
    required this.isLoggedIn,
    this.onCorrect,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (showQuestion && job.question.isNotEmpty) ...[
          Text('質問', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 4),
          SelectableText(job.question),
          const SizedBox(height: 8),
        ],
        if (!job.isFinished) ...[
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: 8),
          const Center(child: Text('裁定を生成しています…')),
          const SizedBox(height: 8),
          const LoadingBannerAd(),
        ] else if (job.status == RulingJobStatus.failed)
          Text(
            job.error ?? '裁定生成中にエラーが発生しました。',
            style: const TextStyle(color: Colors.red),
          )
        else if (job.result != null) ...[
          RulingResultView(result: job.result!),
          if (isLoggedIn && onCorrect != null) ...[
            const SizedBox(height: 8),
            OutlinedButton(onPressed: onCorrect, child: const Text('この裁定を訂正する')),
          ],
        ],
      ],
    );
  }
}
