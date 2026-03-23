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
    readonly domain: opensearch.Domain;
    readonly clusterSettings: OpenSearchClusterSettings;
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
}

interface OpenSearchSettingsProviderProps {
    readonly vpc?: ec2.IVpc;
    readonly vpcSubnets?: ec2.SubnetSelection;
}

class OpenSearchSettingsProvider extends Construct {
    public readonly provider: customResource.Provider;
    public readonly lambdaFunction: lambda.Function;
    public readonly securityGroup?: ec2.ISecurityGroup;

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
            // Create a security group for the Lambda function
            this.securityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
                vpc: props.vpc,
                description: 'Security group for OpenSearch Settings Lambda function',
                allowAllOutbound: false,
            });

            // Add egress rule to allow Lambda to connect to OpenSearch on port 443 (HTTPS)
            this.securityGroup.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(443), 'Allow HTTPS access to OpenSearch domain');

            // Default to PRIVATE_WITH_EGRESS subnets if not specified
            const vpcSubnets = props.vpcSubnets || { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

            Object.assign(lambdaProps, {
                vpc: props.vpc,
                vpcSubnets: vpcSubnets,
                securityGroups: [this.securityGroup],
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

        // Determine if domain is in a VPC using its security groups and, if so,
        // default the VPC to the one associated with the domain when not provided.
        let vpc = props.vpc;
        const vpcSubnets = props.vpcSubnets;
        let domainIsInVpc = false;

        const domainConnections = props.domain.connections;
        const securityGroups = (domainConnections && (domainConnections as any).securityGroups) || [];

        if (Array.isArray(securityGroups) && securityGroups.length > 0) {
            domainIsInVpc = true;

            // If domain is in a VPC but user didn't provide vpc explicitly, try to
            // derive it from the domain's security group's VPC to avoid requiring
            // callers to pass the VPC twice.
            if (!vpc) {
                const derivedVpc = securityGroups[0] && (securityGroups[0] as any).vpc;
                if (derivedVpc) {
                    vpc = derivedVpc;
                }
            }
        }

        // Create a new provider for this construct instance
        const settingsProvider = new OpenSearchSettingsProvider(this, 'Provider', {
            vpc: vpc,
            vpcSubnets: vpcSubnets,
        });

        settingsProvider.lambdaFunction.addToRolePolicy(
            new iam.PolicyStatement({
                resources: [props.domain.domainArn, `${props.domain.domainArn}/*`],
                actions: ['es:ESHttp*'],
            }),
        );

        // If domain is in VPC, automatically configure security group connectivity
        if (domainIsInVpc && settingsProvider.securityGroup) {
            // Allow Lambda's security group to connect to the domain
            props.domain.connections.allowFrom(settingsProvider.securityGroup, ec2.Port.tcp(443), 'Allow Lambda function to access OpenSearch domain');
        }

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
