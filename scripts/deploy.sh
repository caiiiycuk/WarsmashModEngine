#!/usr/bin/env bash

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: $0 VERSION" >&2
  exit 1
fi

./gradlew :html:buildWeb
aws s3 --endpoint-url=https://storage.yandexcloud.net sync --acl public-read \
    html/build/dist/webapp/ s3://dos.zone/warsmash/$VERSION/ --delete 