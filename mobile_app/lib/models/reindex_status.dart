class ReindexStatus {
  final String status; // "idle" | "running" | "completed"
  final int? startedAt;
  final int? finishedAt;
  final int? processed;
  final int? total;
  final int? totalCount;
  final int? updated;
  final int? skipped;
  final int? failed;

  const ReindexStatus({
    required this.status,
    this.startedAt,
    this.finishedAt,
    this.processed,
    this.total,
    this.totalCount,
    this.updated,
    this.skipped,
    this.failed,
  });

  factory ReindexStatus.fromJson(Map<String, dynamic> json) {
    return ReindexStatus(
      status: json['status'] as String,
      startedAt: json['startedAt'] as int?,
      finishedAt: json['finishedAt'] as int?,
      processed: json['processed'] as int?,
      total: json['total'] as int?,
      totalCount: json['totalCount'] as int?,
      updated: json['updated'] as int?,
      skipped: json['skipped'] as int?,
      failed: json['failed'] as int?,
    );
  }
}
