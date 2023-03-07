FROM amazon/aws-lambda-python:3.9

COPY . ${LAMBDA_TASK_ROOT}
COPY requirements.txt .

RUN yum makecache
RUN yum -y install graphviz

RUN pip install -r requirements.txt --target ${LAMBDA_TASK_ROOT}

RUN ZAPPA_HANDLER_PATH=$( \
    python -c "from zappa import handler; print(handler.__file__)" \
    ) \
    && echo $ZAPPA_HANDLER_PATH \
    && cp $ZAPPA_HANDLER_PATH ${LAMBDA_TASK_ROOT}

CMD [ "handler.lambda_handler" ]