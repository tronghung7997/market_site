pipeline {
  agent any
  stages {
    stage('Build & Push') {
      steps {
        sh '''
docker build -t $DOCKER_IMAGE ./frontend
docker build -t $DOCKER_IMAGE_01 ./marketplace-svc

docker push $DOCKER_IMAGE
docker push $DOCKER_IMAGE_01
'''
      }
    }

    stage('Deploy') {
      steps {
        sh '''
        ssh -tt root@172.16.89.2 << EOF
        cd /srv/market_site && docker-compose pull marketplace-svc frontend && docker-compose up -d --force-recreate marketplace-svc frontend
        exit
        EOF
'''
      }
    }

  }
  environment {
    DOCKER_IMAGE = 'registry.k7:5000/market-site/marketplace-svc:latest'
    DOCKER_IMAGE_01 = 'registry.k7:5000/market-site/frontend:latest'
  }
}
