import * as ec2 from 'aws-cdk-lib/aws-ec2';
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
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
    readonly securityGroups?: ec2.ISecurityGroup[];
}

interface OpenSearchSettingsProviderProps {
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
    readonly securityGroups?: ec2.ISecurityGroup[];
}

class OpenSearchSettingsProvider extends Construct {
    public readonly provider: customResource.Provider;
    public readonly lambdaFunction: lambda.Function;

    public static getOrCreate(scope: Construct, props?: OpenSearchSettingsProviderProps): OpenSearchSettingsProvider {
        const stack = cdk.Stack.of(scope);
        // Create a unique ID based on VPC configuration to allow multiple providers with different VPC settings
        const vpcId = props?.vpc ? `-${props.vpc.node.addr}` : '';
        const id = `com.isotoma.cdk.custom-resources.opensearch-settings${vpcId}`;
        const existing = (stack.node.tryFindChild(id) as OpenSearchSettingsProvider) || new OpenSearchSettingsProvider(stack, id, props);
        return existing;
    }

    constructor(scope: Construct, id: string, props?: OpenSearchSettingsProviderProps) {
        super(scope, id);

        const lambdaProps: lambda.FunctionProps = {
            code: lambda.Code.fromAsset(path.join(__dirname, 'provider')),
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.onEvent',
            timeout: cdk.Duration.minutes(5),
        };

        // Add VPC configuration if provided
        if (props?.vpc) {
            Object.assign(lambdaProps, {
                vpc: props.vpc,
                vpcSubnets: props.vpcSubnets,
                securityGroups: props.securityGroups,
            });
        }

        this.lambdaFunction = new lambda.Function(this, 'opensearch-settings-event', lambdaProps);

        this.provider = new customResource.Provider(this, 'opensearch-settings-provider', {
            onEventHandler: this.lambdaFunction,
        });
    }
}

export class OpenSearchSettings extends Construct {
    constructor(scope: Construct, id: string, props: OpenSearchSettingsProps) {
        super(scope, id);

        const settingsProvider = OpenSearchSettingsProvider.getOrCreate(this, {
            vpc: props.vpc,
            vpcSubnets: props.vpcSubnets,
            securityGroups: props.securityGroups,
        });

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
