#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

#define SDA_PIN 21
#define SCL_PIN 22

#define IN3 27
#define IN4 26
#define ENB 14

#define PWM_FREQ 1000
#define PWM_RESOLUTION 8

#define MOTOR_SPEED 180
#define SAMPLE_INTERVAL_US 10000

void motorForward(int speed)
{
  digitalWrite(IN3, HIGH);
  digitalWrite(IN4, LOW);
  ledcWrite(ENB, speed);
}

void motorStop()
{
  digitalWrite(IN3, LOW);
  digitalWrite(IN4, LOW);
  ledcWrite(ENB, 0);
}

void setup()
{
  Serial.begin(115200);

  pinMode(IN3, OUTPUT);
  pinMode(IN4, OUTPUT);

  ledcAttach(ENB, PWM_FREQ, PWM_RESOLUTION);

  motorStop();

  Wire.begin(SDA_PIN, SCL_PIN);

  if (!mpu.begin())
  {
    while (1)
    {
      delay(1000);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_44_HZ);

  delay(1000);

  motorForward(MOTOR_SPEED);
}

void loop()
{
  static unsigned long lastSample = 0;

  if (micros() - lastSample >= SAMPLE_INTERVAL_US)
  {
    lastSample += SAMPLE_INTERVAL_US;

    sensors_event_t acceleration;
    sensors_event_t gyro;
    sensors_event_t temperature;

    mpu.getEvent(&acceleration, &gyro, &temperature);

    Serial.print(acceleration.acceleration.x, 6);
    Serial.print(",");
    Serial.print(acceleration.acceleration.y, 6);
    Serial.print(",");
    Serial.println(acceleration.acceleration.z, 6);
  }
}