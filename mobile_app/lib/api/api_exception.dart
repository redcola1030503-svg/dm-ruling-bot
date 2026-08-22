class ApiException implements Exception {
  final int? statusCode;
  final String message;

  const ApiException(this.message, {this.statusCode});

  /// サーバーが返す内部エラーコード(スネークケースの識別子)を
  /// ユーザー向けの日本語メッセージに変換する。未知のコードはそのまま表示する。
  String get friendlyMessage {
    switch (message) {
      case 'invalid_judge_id':
        return '無効なジャッジIDです。';
      case 'already_running':
        return '既に処理が実行中です。';
      case 'push_token_not_found':
        return '通知の登録が確認できませんでした。通知をONにしてから再度お試しください。';
      case 'push_send_failed':
        return '通知の送信に失敗しました。時間をおいて再度お試しください。';
      default:
        if (statusCode == 429) {
          return 'リクエストが多すぎます。しばらく待ってから再度お試しください。';
        }
        return message;
    }
  }

  @override
  String toString() => message;
}
