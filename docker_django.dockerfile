FROM amazon/aws-lambda-python:3.9
ENV PYTHONUNBUFFERED=1
# WORKDIR ${LAMBDA_TASK_ROOT}
COPY . ${LAMBDA_TASK_ROOT}
# COPY _static ${LAMBDA_TASK_ROOT}
# COPY _staticfiles ${LAMBDA_TASK_ROOT}
# COPY _templates ${LAMBDA_TASK_ROOT}
# COPY accounts ${LAMBDA_TASK_ROOT}
# COPY cbgm ${LAMBDA_TASK_ROOT}
# COPY collation ${LAMBDA_TASK_ROOT}
# COPY CONFIG ${LAMBDA_TASK_ROOT}
# COPY published ${LAMBDA_TASK_ROOT}
# COPY theme ${LAMBDA_TASK_ROOT}
# COPY witnesses ${LAMBDA_TASK_ROOT}
# COPY content ${LAMBDA_TASK_ROOT}
# COPY manage.py ${LAMBDA_TASK_ROOT}
# COPY requirements.txt ${LAMBDA_TASK_ROOT}
# COPY zappa_settings.json ${LAMBDA_TASK_ROOT}
# COPY zappa_settings.py ${LAMBDA_TASK_ROOT}

# RUN yum makecache
# RUN yum -y install graphviz

RUN pip install -r requirements.txt

RUN ZAPPA_HANDLER_PATH=$( \
    python -c "from zappa import handler; print(handler.__file__)" \
    ) \
    && echo $ZAPPA_HANDLER_PATH \
    && cp $ZAPPA_HANDLER_PATH ${LAMBDA_TASK_ROOT}

# CMD [ "handler.lambda_handler" ]