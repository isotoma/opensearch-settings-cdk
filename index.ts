import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as cdk from 'aws-cdk-lib';
import * as customResource from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type OpenSearchClusterSettings = Record<string, any>;

export interface OpenSearchSettingsProps {
    readonly domain: opensearch.IDomain;
    readonly clusterSettings: OpenSearchClusterSettings;
}

class OpenSearchSettingsProvider extends Construct {
    public readonly provider: customResource.Provider;
    public readonly lambdaFunction: lambda.Function;

    public static getOrCreate(scope: Construct): OpenSearchSettingsProvider {
        const stack = cdk.Stack.of(scope);
        const id = 'com.isotoma.cdk.custom-resources.opensearch-settings';
        const existing = (stack.node.tryFindChild(id) as OpenSearchSettingsProvider) || new OpenSearchSettingsProvider(stack, id);
        return existing;
    }

    constructor(scope: Construct, id: string) {
        super(scope, id);

        this.lambdaFunction = new lambda.Function(this, 'opensearch-settings-event', {
            code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.onEvent',
            timeout: cdk.Duration.minutes(5),
        });

        this.provider = new customResource.Provider(this, 'opensearch-settings-provider', {
            onEventHandler: this.lambdaFunction,
        });
    }
}

export class OpenSearchSettings extends Construct {
    constructor(scope: Construct, id: string, props: OpenSearchSettingsProps) {
        super(scope, id);

        const settingsProvider = OpenSearchSettingsProvider.getOrCreate(this);

        settingsProvider.lambdaFunction.addToRolePolicy(
            new iam.PolicyStatement({
                resources: [props.domain.domainArn, `${props.domain.domainArn}/*`],
                actions: ['es:ESHttp*'],
            }),
        );

        new cdk.CustomResource(this, 'Resource', {
            serviceToken: settingsProvider.provider.serviceToken,
            resourceType: 'Custom::OpenSearchSettings',
            properties: {
                OpensearchDomainEndpoint: props.domain.domainEndpoint,
                ClusterSettingsJson: JSON.stringify(props.clusterSettings),
            },
        });
    }
}
