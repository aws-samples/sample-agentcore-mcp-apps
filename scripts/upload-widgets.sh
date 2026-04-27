#!/bin/bash
# Upload widget HTML files to S3 for CloudFront serving.
# Usage: ./upload-widgets.sh <s3-bucket-name>
set -euo pipefail

BUCKET="${1:?Usage: $0 <s3-bucket-name>}"
WIDGETS_DIR="$(dirname "$0")/../sample-widgets"

echo "Uploading widgets to s3://${BUCKET}/ ..."
aws s3 sync "$WIDGETS_DIR" "s3://${BUCKET}/" --content-type "text/html"

echo "Done! Widgets uploaded to s3://${BUCKET}/"
echo "Invalidate CloudFront cache if needed: aws cloudfront create-invalidation --distribution-id <DIST_ID> --paths '/*'"
