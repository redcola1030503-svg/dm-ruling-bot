import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

/// dm-wikiはツインパクトカードのページ名を全角スラッシュ(／)区切りの
/// 《カード名》形式で登録しているため、半角スラッシュを変換して生成する。
Uri buildDmWikiUri(String cardName) {
  final normalized = cardName.trim().replaceAll(RegExp(r'\s*/\s*'), '／');
  return Uri.parse('https://dmwiki.net/${Uri.encodeComponent('《$normalized》')}');
}

Future<void> openExternalUri(BuildContext context, Uri uri) async {
  final launched = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!launched && context.mounted) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('リンクを開けませんでした: $uri')),
    );
  }
}
