import { AccessScope } from '@guardian/cdk/lib/constants';
import type { GuStackProps } from '@guardian/cdk/lib/constructs/core';
import { GuStack } from '@guardian/cdk/lib/constructs/core';
import { GuEc2App } from '@guardian/cdk/lib/patterns/ec2-app';
import type { App } from 'aws-cdk-lib';
import { InstanceClass, InstanceSize, InstanceType } from 'aws-cdk-lib/aws-ec2';

const app = 'feature-library';

export interface FeatureLibraryProps extends GuStackProps {
	domainName: string;
}

export class FeatureLibrary extends GuStack {
	constructor(scope: App, id: string, props: FeatureLibraryProps) {
		super(scope, id, props);

		new GuEc2App(this, {
			app,
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
					executionStatement: `dpkg -i /${app}/${app}.deb`,
				},
			},
			certificateProps: { domainName: props.domainName },
			scaling: { minimumInstances: 1, maximumInstances: 2 },
			healthcheck: { path: '/management/healthcheck' },
		});
	}
}
