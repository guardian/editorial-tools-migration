import { AccessScope } from '@guardian/cdk/lib/constants';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { GuStack } from '@guardian/cdk/lib/constructs/core';
import { GuCname } from '@guardian/cdk/lib/constructs/dns';
import {
	GuGetS3ObjectsPolicy,
	type GuPolicy,
} from '@guardian/cdk/lib/constructs/iam';
import { GuEc2App } from '@guardian/cdk/lib/patterns/ec2-app';
import { type App, Duration, RemovalPolicy } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize, InstanceType } from 'aws-cdk-lib/aws-ec2';
import { BlockPublicAccess, Bucket } from 'aws-cdk-lib/aws-s3';

const app = 'feature-library';

export interface FeatureLibraryProps extends GuStackProps {
	domainName: string;
}

export class FeatureLibrary extends GuStack {
	constructor(scope: App, id: string, props: FeatureLibraryProps) {
		super(scope, id, props);

		const configBucket = new Bucket(this, 'FeatureLibraryData', {
			bucketName: `${app}-${props.stage.toLowerCase()}`,
			blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
			removalPolicy: RemovalPolicy.RETAIN,
		});

		const instanceAdditionPolicies: GuPolicy[] = [
			new GuGetS3ObjectsPolicy(this, 'ReadApplicationSecret', {
				bucketName: configBucket.bucketName,
				paths: ['conf/application.secret.conf'],
			}),
		];

		const ec2App = new GuEc2App(this, {
			app,
			additionalPolicies: instanceAdditionPolicies,
			access: { scope: AccessScope.PUBLIC },
			applicationPort: 9000,
			instanceType: InstanceType.of(
				InstanceClass.BURSTABLE4_GRAVITON,
				InstanceSize.MICRO,
			),
			instanceMetricGranularity: '5Minute',
			monitoringConfiguration: { noMonitoring: true },
			applicationLogging: { enabled: true },
			imageRecipe: 'editorial-tools-jammy-java25',
			userData: {
				distributable: {
					fileName: `${app}.deb`,
					executionStatement: [
						`aws s3 cp 's3://${configBucket.bucketName}/conf/application.secret.conf' /etc/gu/application.secret.conf`,
						`dpkg -i /${app}/${app}.deb`,
					].join('\n'),
				},
			},
			certificateProps: { domainName: props.domainName },
			scaling: { minimumInstances: 1, maximumInstances: 2 },
			healthcheck: { path: '/management/healthcheck' },
		});

		new GuCname(this, 'DnsRecord', {
			app,
			domainName: props.domainName,
			ttl: Duration.minutes(5),
			// Trailing dot to match NS1 records fully-qualified format.
			resourceRecord: `${ec2App.loadBalancer.loadBalancerDnsName}.`,
		});
	}
}
