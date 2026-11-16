# Infrastructure

This directory defines the components to be deployed to AWS.

See [`package.json`](./package.json) for a list of available scripts.

## Application secret

Each stage creates a private bucket named `feature-library-<stage>`, with the
stage lowercased: `feature-library-code` or `feature-library-prod`. Public access
is blocked, and buckets are retained if the stack is deleted.

Upload a configuration file to `conf/application.secret.conf` in the appropriate
bucket. There is no stage prefix in the object key. S3 creates the `conf/` prefix
when the file is uploaded; no empty folder object is needed. The file must define
`play.http.secret.key` with a stable, cryptographically random secret. Use a
different secret for each stage and do not commit secrets to the repository.

For example, from the repository root, upload the local configuration to CODE:

```sh
aws s3 cp feature-library/conf/application.secret.conf \
	s3://feature-library-code/conf/application.secret.conf --region eu-west-1
```

Use `feature-library-prod` for PROD.

On startup, instances download that object to `/etc/gu/application.secret.conf`
before installing the Debian package. Play includes it from
[`application.conf`](../feature-library/conf/application.conf). The instance role
receives read access to this object through `GuGetS3ObjectsPolicy`, supplied to
`GuEc2App` via `additionalPolicies`.

The startup commands do not explicitly create `/etc/gu` or set local file
permissions. Ensure the directory exists and the downloaded file is readable by
the application user while restricting access to the secret.

For the first deployment, upload the file once the bucket has been created, then
replace any instances that started before the upload. Without the file or an
`APPLICATION_SECRET` environment variable, Play cannot start in production mode.
Updating the S3 object does not change existing instances; replace them to fetch
it again. Changing the secret invalidates existing sessions.

Local development and tests do not require the `/etc/gu` file; Play generates a
development/test secret when none is supplied. `APPLICATION_SECRET`, when set,
overrides the included secret. The local
[`application.secret.conf`](../feature-library/conf/application.secret.conf) is
ignored by Git and is not included by the application configuration.
