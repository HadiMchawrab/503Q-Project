# AWS-provided Lambda Python base image. CI builds this and pushes to the ECR repo
# created by the Terraform lambda module.
FROM public.ecr.aws/lambda/python:3.12

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY handler.py ./

# Format: <module>.<function>
CMD ["handler.handler"]
