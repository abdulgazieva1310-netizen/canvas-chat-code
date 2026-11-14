# AWS Free Plan deployment

The deployment has separate Dev and Production EC2 instances. Each instance runs the app and its own PostgreSQL container with Docker Compose and a host-local data volume. Both public hostnames resolve to the Dev instance's public IP; Caddy on that instance terminates HTTPS and routes the Production hostname to the Production instance over its private address. Production's port 8100 accepts traffic only from the Dev security group. Neither environment exposes SSH or PostgreSQL.

The existing `interview-mirror-staging` stack is the Dev environment. The independent `interview-mirror-production` stack owns separate compute, PostgreSQL storage, app media storage, IAM role, and security group. Production has an auto-assigned public IPv4 for outbound bootstrap and updates, but its app port is not open to the internet. Both stacks use the existing VPC and public subnet. No RDS, ECR, NAT gateway, load balancer, ECS, or Secrets Manager resources are created.

## Free Plan limits

The deployment targets a Free Plan account. AWS reports that Free Plan accounts do not incur charges while the plan is active; the account closes when its credits are exhausted or the plan expires. Check `aws freetier get-account-plan-state --region us-east-1` before deploying and during the demo. This is a time-limited proof of concept, not a permanent free hosting guarantee.

Both instances are fixed to `t3.micro` with standard CPU credits and each has a 20 GB encrypted root volume plus a 2 GB swap file for Docker builds. Two instances, their disks, public IPv4 addresses, and network traffic consume more credits than one instance. Confirm the active Free Plan credit balance before use. Do not increase instance sizes or disk allocation. Each local PostgreSQL volume is independent and is not a backup; export important data before replacing either instance.

AWS Free Plans and offers can change. The deployed account was checked as `FREE` and `ACTIVE` with remaining credits before this deployment. A Free Plan prevents a payable AWS bill while active, but credit consumption can end the plan and suspend access to resources and data.

## Deploy

The repository branch named by each template's `GitBranch` parameter must be public and contain the deployment configuration. Each instance builds the application image locally. CloudFormation waits for its app's `/api/health` process check before completing.

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

aws cloudformation deploy \
  --template-file infrastructure/production-template.yaml \
  --stack-name interview-mirror-production \
  --region eu-central-1 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    GitBranch=main \
    DevSecurityGroupId=sg-0eceb1e16436bead1 \
    ProdDomain=35.157.122.141.nip.io
```

Read the application URL and instance ID from the stack outputs:

```sh
aws cloudformation describe-stacks \
  --stack-name interview-mirror-staging \
  --region eu-central-1 \
  --query 'Stacks[0].Outputs' \
  --output table
```

The current public URLs are `https://35.157.122.141.nip.io` for Production and `https://dev.35.157.122.141.nip.io` for Dev. `nip.io` resolves both names to the current Dev ingress IP. Caddy obtains certificates for both names. Verify each health endpoint:

```sh
curl --fail --show-error --retry 18 --retry-delay 10 \
  https://35.157.122.141.nip.io/api/health
curl --fail --show-error --retry 18 --retry-delay 10 \
  https://dev.35.157.122.141.nip.io/api/health
```

The app disables the seeded demo account on the public host. Register a new account through the site. AI is optional; when no Groq key is configured, the app uses deterministic fallback questions and feedback. Local email mode does not send password reset messages.

## Optional Groq key

Each instance reads its optional Groq key from a separate standard `SecureString` in Systems Manager Parameter Store: `/interview-mirror-ec2/groq-api-key` for Dev and `/interview-mirror-production/groq-api-key` for Production. Neither parameter is created by CloudFormation, and both apps start without a key. Standard parameters have no additional Parameter Store charge; SecureString uses the AWS managed `aws/ssm` key. Never place the key in CloudFormation user data, repository files, command-line arguments, or logs.

Create or update the parameter through a hidden terminal prompt, using `aws ssm put-parameter --type SecureString --tier Standard --name /interview-mirror-ec2/groq-api-key --value file:///dev/stdin --overwrite --region eu-central-1`, then restart the app container through Session Manager so it reads the new value. Groq billing is separate from AWS billing; use a Groq Free account if external API charges must also remain at zero.

## Update the app

The CI workflow updates the Dev instance over Systems Manager after all checks pass on pushes to `main`. To update Production separately, connect to its instance with Session Manager and run:

```sh
cd /opt/interview-mirror/repo
git pull --ff-only
docker compose --env-file /opt/interview-mirror/runtime.env build app
docker compose --env-file /opt/interview-mirror/runtime.env --profile aws up -d
```

Each Compose installation stores PostgreSQL data and media in separate named Docker volumes on its EC2 root disk. The Dev instance also stores Caddy certificates. Back up database and recordings before replacing either instance. `docker compose down --volumes` deletes that instance's PostgreSQL and media volumes.

## Remove the deployment

Delete the stack when the demo is finished:

```sh
aws cloudformation delete-stack \
  --stack-name interview-mirror-production \
  --region eu-central-1

aws cloudformation delete-stack \
  --stack-name interview-mirror-staging \
  --region eu-central-1
```

Each EC2 root disk is deleted with its instance. Parameter Store values are separate from the stacks and should be deleted when no longer needed:

```sh
aws ssm delete-parameter \
  --name /interview-mirror-ec2/groq-api-key \
  --region eu-central-1

aws ssm delete-parameter \
  --name /interview-mirror-production/groq-api-key \
  --region eu-central-1
```

`GET /api/health` is a liveness check only. It returns `{"status":"ok"}` without checking PostgreSQL, Groq, or email delivery. The EC2 instance is a single point of failure, and the attached disk is not durable backup storage.
