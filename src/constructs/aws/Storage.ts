import { BlockPublicAccess, Bucket, BucketEncryption, StorageClass } from '@aws-cdk/aws-s3';
import { CfnOutput, Construct, Duration, Fn, Stack } from '@aws-cdk/core';
import { FromSchema } from 'json-schema-to-ts';
import AwsConstruct from './AwsConstruct';
import { PolicyStatement } from '../../Stack';
import AwsProvider from './AwsProvider';

export const STORAGE_DEFINITION = {
    type: 'object',
    properties: {
        type: { const: 'storage' },
        archive: { type: 'number', minimum: 30 },
        encryption: {
            anyOf: [{ const: 's3' }, { const: 'kms' }],
        },
    },
    additionalProperties: false,
    required: ['type'],
} as const;
const STORAGE_DEFAULTS = {
    archive: 45,
    encryption: 's3',
};

export class Storage extends Construct implements AwsConstruct {
    private readonly bucket: Bucket;
    private readonly bucketNameOutput: CfnOutput;

    constructor(
        scope: Construct,
        private readonly provider: AwsProvider,
        id: string,
        configuration: FromSchema<typeof STORAGE_DEFINITION>
    ) {
        super(scope, id);

        const resolvedConfiguration = Object.assign({}, STORAGE_DEFAULTS, configuration);

        const encryptionOptions = {
            s3: BucketEncryption.S3_MANAGED,
            kms: BucketEncryption.KMS_MANAGED,
        };

        this.bucket = new Bucket(this, 'Bucket', {
            encryption: encryptionOptions[resolvedConfiguration.encryption],
            versioned: true,
            blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
            lifecycleRules: [
                {
                    transitions: [
                        {
                            storageClass: StorageClass.INTELLIGENT_TIERING,
                            transitionAfter: Duration.days(0),
                        },
                    ],
                },
                {
                    noncurrentVersionExpiration: Duration.days(30),
                },
            ],
        });
        // Allow all Lambda functions of the stack to read/write the bucket
        this.bucket.grantReadWrite(this.provider.lambdaRole);

        this.bucketNameOutput = new CfnOutput(this, 'BucketName', {
            value: this.bucket.bucketName,
        });
    }

    permissions(): PolicyStatement[] {
        return [
            new PolicyStatement(
                ['s3:PutObject', 's3:GetObject', 's3:DeleteObject', 's3:ListBucket'],
                [this.bucket.bucketArn, Stack.of(this).resolve(Fn.join('/', [this.bucket.bucketArn, '*']))]
            ),
        ];
    }

    outputs(): Record<string, () => Promise<string | undefined>> {
        return {
            bucketName: () => this.getBucketName(),
        };
    }

    commands(): Record<string, () => Promise<void>> {
        return {};
    }

    references(): Record<string, string> {
        return {
            bucketArn: this.bucket.bucketArn,
        };
    }

    async getBucketName(): Promise<string | undefined> {
        return this.provider.getStackOutput(this.bucketNameOutput);
    }
}