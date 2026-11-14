# AWS Free Plan deployment

This deployment uses one `t3.micro` EC2 instance in `eu-central-1`. Docker Compose runs the application and PostgreSQL together, with PostgreSQL stored in a named Docker volume. Caddy proxies the application over HTTPS using a hostname derived from the instance's public IP. PostgreSQL is reachable only inside the Compose network and on the instance loopback.

The CloudFormation template uses the account's existing default VPC and public subnet. It creates one EC2 instance, a security group, an IAM role and instance profile for Systems Manager access, and no RDS, ECR, NAT gateway, load balancer, or Secrets Manager resources. The instance's ports 80 and 443 are public; port 22 and database port 5432 are not opened. Use Systems Manager Session Manager for administration.

## Free Plan limits

The deployment targets a Free Plan account. AWS reports that Free Plan accounts do not incur charges while the plan is active; the account closes when its credits are exhausted or the plan expires. Check `aws freetier get-account-plan-state --region us-east-1` before deploying and during the demo. This is a time-limited proof of concept, not a permanent free hosting guarantee.

The instance is deliberately fixed to `t3.micro` with standard CPU credits to avoid Unlimited-mode surplus CPU charges. It has a 20 GB encrypted root volume and a 2 GB swap file to support the Docker build. Do not increase the instance size, disk, or running resources without checking the account plan. The local PostgreSQL volume is not a backup; export important data before deleting or replacing the instance.

AWS Free Plans and offers can change. The deployed account was checked as `FREE` and `ACTIVE` with remaining credits before this deployment. A Free Plan prevents a payable AWS bill while active, but credit consumption can end the plan and suspend access to resources and data.

## Deploy

The repository branch named by the template's `GitBranch` parameter must be public and contain the deployment configuration. The instance clones that branch and builds the application image locally. CloudFormation waits for the app's `/api/health` process check before completing.

Validate and deploy from the repository root:

```sh
aws cloudformation validate-template \
  --template-body file://infrastructure/template.yaml \
  --region eu-central-1

aws cloudformation deploy \
  --template-file infrastructure/template.yaml \
  --stack-name interview-mirror-staging \
  --region eu-central-1 \
  --capabilities CAPABILITY_IAM
```

Read the application URL and instance ID from the stack outputs:

```sh
aws cloudformation describe-stacks \
  --stack-name interview-mirror-staging \
  --region eu-central-1 \
  --query 'Stacks[0].Outputs' \
  --output table
```

The URL uses `nip.io` to resolve the public IP and Caddy obtains an HTTPS certificate. Certificate issuance can take several minutes after CloudFormation completes. Verify the application health endpoint:

```sh
curl --fail --show-error --retry 18 --retry-delay 10 \
  "$(aws cloudformation describe-stacks --stack-name interview-mirror-staging --region eu-central-1 --query "Stacks[0].Outputs[?OutputKey=='ApplicationUrl'].OutputValue | [0]" --output text)/api/health"
```

The app disables the seeded demo account on the public host. Register a new account through the site. AI is optional; when no Groq key is configured, the app uses deterministic fallback questions and feedback. Local email mode does not send password reset messages.

## Optional Groq key

The instance reads the optional Groq key from a standard `SecureString` in Systems Manager Parameter Store. The parameter is not created by CloudFormation, and the app starts without it. Standard parameters have no additional Parameter Store charge; SecureString uses the AWS managed `aws/ssm` key. Never place the key in CloudFormation user data, repository files, command-line arguments, or logs.

Create or update the parameter through a hidden terminal prompt, using `aws ssm put-parameter --type SecureString --tier Standard --name /interview-mirror-ec2/groq-api-key --value file:///dev/stdin --overwrite --region eu-central-1`, then restart the app container through Session Manager so it reads the new value. Groq billing is separate from AWS billing; use a Groq Free account if external API charges must also remain at zero.

## Update the app

After publishing changes to the configured Git branch, connect with Session Manager and run:

```sh
cd /opt/interview-mirror/repo
git pull --ff-only
docker compose --env-file /opt/interview-mirror/runtime.env build app
docker compose --env-file /opt/interview-mirror/runtime.env --profile aws up -d
```

The Compose configuration stores PostgreSQL data, audio recordings, and Caddy certificates in named Docker volumes on the EC2 root disk. Back up the database and recordings before instance replacement. `docker compose down --volumes` deletes the PostgreSQL and media volumes and permanently removes those data.

## Remove the deployment

Delete the stack when the demo is finished:

```sh
aws cloudformation delete-stack \
  --stack-name interview-mirror-staging \
  --region eu-central-1
```

The EC2 root disk is deleted with the instance. Parameter Store values are separate from the stack and should be deleted when no longer needed:

```sh
aws ssm delete-parameter \
  --name /interview-mirror-ec2/groq-api-key \
  --region eu-central-1
```

`GET /api/health` is a liveness check only. It returns `{"status":"ok"}` without checking PostgreSQL, Groq, or email delivery. The EC2 instance is a single point of failure, and the attached disk is not durable backup storage.
