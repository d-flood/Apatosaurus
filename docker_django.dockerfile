# FROM amazon/aws-lambda-python:3.10
FROM python:3.11-slim-buster

ARG LAMBDA_TASK_ROOT="/var/task/"
RUN mkdir -p ${LAMBDA_TASK_ROOT}
WORKDIR ${LAMBDA_TASK_ROOT}
COPY . ${LAMBDA_TASK_ROOT}
COPY requirements.txt .
# RUN yum makecache
# RUN yum install glib* -y
# RUN yum update -y
# RUN yum -y install graphviz
RUN apt-get update
RUN apt-get install -y graphviz

ENV ZAPPA_RUNNING_IN_DOCKER=True
RUN pip install -r requirements.txt --target ${LAMBDA_TASK_ROOT}

RUN ZAPPA_HANDLER_PATH=$( \
    python -c "from zappa import handler; print(handler.__file__)" \
    ) \
    && echo $ZAPPA_HANDLER_PATH \
    && cp $ZAPPA_HANDLER_PATH ${LAMBDA_TASK_ROOT}
    
ENTRYPOINT [ "/usr/local/bin/python", "-m", "awslambdaric" ]
CMD [ "handler.lambda_handler" ]