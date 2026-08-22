import 'package:share_plus/share_plus.dart';

import '../models/ruling_result.dart';

/// 質問と裁定結果をOSの共有シート経由でテキスト共有する。
/// AIによる参考情報である旨の注記を必ず添えて共有する。
Future<void> shareRuling(String question, RulingResult result) async {
  final buffer = StringBuffer()
    ..writeln('【質問】')
    ..writeln(question)
    ..writeln()
    ..writeln('【裁定】')
    ..writeln(result.conclusion)
    ..writeln()
    ..writeln(result.explanation)
    ..writeln()
    ..writeln('※AIによる参考情報です。大会等では必ず運営・ジャッジにご確認ください。')
    ..write('― デュエマ裁定確認アプリ AIティーチャーくん');

  await SharePlus.instance.share(
    ShareParams(text: buffer.toString(), subject: 'デュエマ裁定確認: $question'),
  );
}
